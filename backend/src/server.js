import "dotenv/config";
import bcrypt from "bcryptjs";
import cors from "cors";
import { createHash, randomBytes } from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import { ensureSchema, generateBusinessIdCode, pool } from "./db.js";

const app = express();
const port = Number(process.env.PORT || 4000);
const jwtSecret = process.env.JWT_SECRET || "change-me";
const ownerSignupKey =
  process.env.cow_flow_sign_up_pass || process.env.COW_FLOW_SIGN_UP_PASS || "admin";
const configuredCorsOrigins = (process.env.CORS_ORIGIN || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedCorsOrigins = new Set([
  ...configuredCorsOrigins,
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:5600",
  "http://127.0.0.1:5600",
]);

function isPrivateNetworkOrigin(origin) {
  try {
    const url = new URL(origin);
    const allowedPorts = new Set(["3000", "4000", "5173", "5500", "5600"]);
    const hostname = url.hostname;

    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      allowedPorts.has(url.port) &&
      (hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
        /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
        /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname))
    );
  } catch {
    return false;
  }
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedCorsOrigins.has(origin) || isPrivateNetworkOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin not allowed by CORS."));
    },
  }),
);
app.use(express.json({ limit: "10mb" }));

function createToken(user) {
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.name;

  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      username: user.username,
      name: fullName,
      businessId: user.business_id,
    },
    jwtSecret,
    { expiresIn: "8h" },
  );
}

const accessSections = ["dashboard", "profile", "inventory", "branches"];
const ownerPermissions = {
  sections: Object.fromEntries(accessSections.map((section) => [section, true])),
  branchAccess: { mode: "all", branchIds: [] },
  accountSettings: true,
  manageAccounts: true,
  businessSettings: true,
};
const defaultMemberPermissions = {
  sections: { dashboard: true, profile: true, inventory: false, branches: false },
  branchAccess: { mode: "selected", branchIds: [] },
  accountSettings: true,
  manageAccounts: false,
  businessSettings: false,
};

function normalizePermissions(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const sections = source.sections && typeof source.sections === "object" ? source.sections : {};
  const branchAccess = source.branchAccess && typeof source.branchAccess === "object" ? source.branchAccess : {};
  const pickBoolean = (value, fallback) => (typeof value === "boolean" ? value : fallback);

  return {
    sections: Object.fromEntries(
      accessSections.map((section) => [
        section,
        pickBoolean(sections[section], defaultMemberPermissions.sections[section]),
      ]),
    ),
    branchAccess: {
      mode: branchAccess.mode === "all" ? "all" : "selected",
      branchIds: Array.isArray(branchAccess.branchIds)
        ? [...new Set(branchAccess.branchIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
        : [],
    },
    accountSettings: pickBoolean(source.accountSettings, defaultMemberPermissions.accountSettings),
    manageAccounts: pickBoolean(source.manageAccounts, defaultMemberPermissions.manageAccounts),
    businessSettings: pickBoolean(source.businessSettings, defaultMemberPermissions.businessSettings),
  };
}

function getEffectivePermissions(user) {
  return user.role === "owner" ? ownerPermissions : normalizePermissions(user.permissions);
}

async function loadAccess(userId) {
  const result = await pool.query("SELECT id, business_id, role, permissions FROM users WHERE id = $1", [userId]);
  const user = result.rows[0];

  if (!user) {
    const error = new Error("User not found.");
    error.status = 401;
    throw error;
  }

  const permissions = getEffectivePermissions(user);

  return {
    userId: user.id,
    businessId: user.business_id,
    isOwner: user.role === "owner",
    permissions,
    // null means every branch of the business.
    allowedBranchIds: permissions.branchAccess.mode === "all" ? null : permissions.branchAccess.branchIds,
  };
}

function canAccessBranch(access, branchId) {
  return access.allowedBranchIds === null || access.allowedBranchIds.includes(Number(branchId));
}

function hasAllBranches(access) {
  return access.allowedBranchIds === null;
}

function requireAccess(check) {
  return async (req, res, next) => {
    try {
      req.access = await loadAccess(req.user.sub);
    } catch (error) {
      return res.status(error.status || 500).json({ message: error.message || "Unable to check access." });
    }

    if (!check(req.access, req)) {
      return res.status(403).json({ message: "Your account does not have access to this. Ask the business owner." });
    }

    return next();
  };
}

const section = (name) => (access) => access.permissions.sections[name];

// Uppercases the first letter of each word and leaves the rest alone, so "McDonald" stays as typed.
function capitalizeWords(value) {
  return String(value ?? "").replace(/(^|[\s._-])(\p{L})/gu, (_, separator, letter) => separator + letter.toUpperCase());
}

function serializeUser(user) {
  const firstName = capitalizeWords(user.first_name);
  const lastName = capitalizeWords(user.last_name);
  const fullName = [firstName, lastName].filter(Boolean).join(" ") || capitalizeWords(user.name);

  return {
    id: user.id,
    firstName,
    lastName,
    username: capitalizeWords(user.username),
    businessId: user.business_id,
    businessCode: user.business_id_code,
    businessName: capitalizeWords(user.business_name),
    businessLogo: user.logo_image || null,
    lowStockThreshold: Number(user.low_stock_threshold ?? 3),
    email: user.email,
    profileImage: user.profile_image || null,
    bannerImage: user.banner_image || null,
    role: user.role || "owner",
    permissions: getEffectivePermissions(user),
    name: fullName,
    createdAt: user.created_at,
  };
}

const maxImageDataLength = 2 * 1024 * 1024;

function normalizeImageData(value) {
  if (value === null || value === "") {
    return { ok: true, value: null };
  }

  if (
    typeof value !== "string" ||
    !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value) ||
    value.length > maxImageDataLength
  ) {
    return { ok: false };
  }

  return { ok: true, value };
}

const userProfileSelect = `
  SELECT users.id, users.name, users.first_name, users.last_name, users.username,
    users.business_id, users.business_name, businesses.business_id_code, businesses.logo_image,
    businesses.low_stock_threshold, users.email, users.profile_image, users.banner_image, users.role,
    users.permissions, users.created_at
  FROM users
  LEFT JOIN businesses ON businesses.id = users.business_id
  WHERE users.id = $1
`;

function serializeBranch(branch) {
  return {
    id: branch.id,
    businessId: branch.business_id,
    name: branch.name,
    details: branch.details || "",
    posCode: branch.pos_code,
    isDisabled: branch.is_disabled,
    sortOrder: branch.sort_order,
    createdAt: branch.created_at,
    updatedAt: branch.updated_at,
  };
}

function serializeInventoryItem(item) {
  return {
    id: item.id,
    businessId: item.business_id,
    name: item.name,
    stocks: Number(item.stocks || 0),
    branchStock: Number(item.branch_stock || 0),
    price: Number(item.price || 0),
    sortOrder: item.sort_order,
    imageData: item.image_data,
    imageMime: item.image_mime,
    imageName: item.image_name,
    branches: item.branches || [],
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

function serializeInventoryHistoryEntry(entry) {
  return {
    id: entry.id,
    itemId: entry.inventory_item_id,
    branchId: entry.branch_id,
    branchName: entry.branch_name,
    action: entry.action,
    quantity: entry.quantity,
    createdByName: entry.created_by_name,
    createdAt: entry.created_at,
  };
}

function serializeInventoryPriceHistoryEntry(entry) {
  return {
    id: entry.id,
    itemId: entry.inventory_item_id,
    oldPrice: entry.old_price === null ? null : Number(entry.old_price),
    newPrice: Number(entry.new_price || 0),
    createdByName: entry.created_by_name,
    createdAt: entry.created_at,
  };
}

function serializePosSession(row) {
  return {
    business: {
      id: row.business_id,
      name: row.business_name,
      code: row.business_id_code,
      logo: row.logo_image || null,
    },
    branch: {
      id: row.branch_id,
      name: row.branch_name,
      code: row.pos_code,
    },
  };
}

function serializePosItem(item) {
  return {
    id: item.id,
    itemCode: `ITEM-${String(item.id).padStart(4, "0")}`,
    name: item.name,
    imageData: item.image_data,
    stockLeft: Number(item.stock_left || 0),
    price: Number(item.price || 0),
  };
}

function serializePosReceipt(row, items) {
  const totalItems = Number(row.total_items || 0);
  const returnedItems = Number(row.returned_items || 0);

  return {
    id: row.id,
    receiptCode: row.receipt_code,
    businessName: row.business_name,
    branchName: row.branch_name,
    totalItems,
    returnedItems,
    isFullyReturned: totalItems > 0 && returnedItems >= totalItems,
    totalAmount: Number(row.total_amount || 0),
    createdAt: row.created_at,
    items: items.map((item) => ({
      itemCode: item.item_code,
      itemName: item.item_name,
      quantity: Number(item.quantity || 0),
      refundedQuantity: Number(item.refunded_quantity || 0),
      unitPrice: Number(item.unit_price || 0),
      totalPrice: Number(item.total_price || 0),
    })),
  };
}

function serializePosSale(row) {
  const totalItems = Number(row.total_items || 0);
  const returnedItems = Number(row.returned_items || 0);

  return {
    id: row.id,
    receiptCode: row.receipt_code,
    totalItems,
    returnedItems,
    isFullyReturned: totalItems > 0 && returnedItems >= totalItems,
    totalAmount: Number(row.total_amount || 0),
    returnedAmount: Number(row.returned_amount || 0),
    itemSold: row.item_sold || "",
    createdAt: row.created_at,
  };
}

function serializeRefundSearchReceipt(row) {
  return {
    id: row.id,
    receiptCode: row.receipt_code,
    totalItems: Number(row.total_items || 0),
    totalAmount: Number(row.total_amount || 0),
    itemSold: row.item_sold || "",
    createdAt: row.created_at,
  };
}

function serializeRefundSearchItem(row) {
  return {
    saleItemId: row.sale_item_id,
    saleId: row.sale_id,
    receiptCode: row.receipt_code,
    itemId: row.inventory_item_id,
    itemCode: row.item_code,
    itemName: row.item_name,
    soldQuantity: Number(row.sold_quantity || 0),
    refundedQuantity: Number(row.refunded_quantity || 0),
    refundableQuantity: Number(row.refundable_quantity || 0),
    unitPrice: Number(row.unit_price || 0),
    createdAt: row.created_at,
  };
}

function serializePosRefund(row) {
  return {
    id: row.id,
    refundCode: row.refund_code,
    receiptCode: row.receipt_code,
    totalItems: Number(row.total_items || 0),
    totalAmount: Number(row.total_amount || 0),
    itemReturned: row.item_returned || "",
    createdAt: row.created_at,
  };
}

async function getCurrentBusinessId(userId, client = pool) {
  const result = await client.query("SELECT business_id FROM users WHERE id = $1", [userId]);
  const user = result.rows[0];

  if (!user) {
    const error = new Error("User not found.");
    error.status = 404;
    throw error;
  }

  if (!user.business_id) {
    const error = new Error("User does not have a business.");
    error.status = 400;
    throw error;
  }

  return user.business_id;
}

function validateBranchFields({ name, details, posCode }) {
  if (!String(name || "").trim() || !String(posCode || "").trim()) {
    return "Branch name and POS code are required.";
  }

  if (String(details || "").length > 1000) {
    return "Details must be 1000 characters or fewer.";
  }

  return null;
}

function getRequestedBranchIds(body) {
  const allocations = Array.isArray(body?.branchAllocations) ? body.branchAllocations : [{ branchId: body?.branchId }];

  return allocations.map((allocation) => Number(allocation?.branchId)).filter((id) => Number.isInteger(id) && id > 0);
}

async function isPosCodeTaken(businessId, posCode, exceptBranchId = null) {
  const result = await pool.query(
    `
      SELECT 1
      FROM branches
      WHERE business_id = $1 AND pos_code = $2 AND ($3::int IS NULL OR id <> $3)
      LIMIT 1
    `,
    [businessId, String(posCode).trim(), exceptBranchId],
  );

  return result.rowCount > 0;
}

function validateInventoryFields({ name, stocks, price, branchAllocations }) {
  const stockCount = Number(stocks);
  const itemPrice = Number(price);

  if (
    stocks === "" ||
    stocks === null ||
    stocks === undefined ||
    !name ||
    !Number.isInteger(stockCount) ||
    stockCount <= 0
  ) {
    return "Item name and a stock count greater than zero are required.";
  }

  if (
    price === "" ||
    price === null ||
    price === undefined ||
    !Number.isFinite(itemPrice) ||
    itemPrice < 0
  ) {
    return "Price must be zero or greater.";
  }

  if (!Array.isArray(branchAllocations) || branchAllocations.length === 0) {
    return "Select at least one branch.";
  }

  const assignedTotal = branchAllocations.reduce(
    (total, allocation) => total + Number(allocation.stocks),
    0,
  );
  const hasInvalidAllocation = branchAllocations.some((allocation) => {
    const branchId = Number(allocation.branchId);
    const branchStocks = Number(allocation.stocks);

    return !Number.isInteger(branchId) || !Number.isInteger(branchStocks) || branchStocks <= 0;
  });

  if (hasInvalidAllocation) {
    return "Fill stocks for every selected branch.";
  }

  if (assignedTotal !== stockCount) {
    return "All stocks must be assigned before saving.";
  }

  return null;
}

function validateInventoryImage({ imageData, imageMime }) {
  if (!imageData && !imageMime) {
    return null;
  }

  if (!imageData || !imageMime) {
    return "Inventory image is incomplete.";
  }

  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(imageMime)) {
    return "Use a JPG, PNG, WebP, or GIF image.";
  }

  if (!String(imageData).startsWith(`data:${imageMime};base64,`)) {
    return "Inventory image is invalid.";
  }

  return null;
}

function validatePositiveIntegerStock(value) {
  const stockCount = Number(value);

  if (!Number.isInteger(stockCount) || stockCount <= 0) {
    return null;
  }

  return stockCount;
}

function authenticate(req, res, next) {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Missing authorization token." });
  }

  const token = header.slice(7);

  try {
    req.user = jwt.verify(token, jwtSecret);
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid authorization token." });
  }
}

async function authenticatePos(req, res, next) {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Missing POS authorization token." });
  }

  const token = header.slice(7);
  let payload;

  try {
    payload = jwt.verify(token, jwtSecret);
  } catch {
    return res.status(401).json({ message: "Invalid POS authorization token." });
  }

  if (!payload.pos || !payload.businessId || !payload.branchId) {
    return res.status(401).json({ message: "Invalid POS authorization token." });
  }

  // A POS token outlives a branch being disabled, so re-check the branch on every request.
  try {
    const branch = await pool.query(
      `
        SELECT branches.is_disabled
        FROM branches
        JOIN businesses ON businesses.id = branches.business_id
        WHERE branches.id = $1 AND businesses.id = $2 AND businesses.status = 'A'
      `,
      [payload.branchId, payload.businessId],
    );

    if (!branch.rows[0]) {
      return res.status(401).json({ code: "POS_SESSION_ENDED", message: "This branch no longer exists." });
    }

    if (branch.rows[0].is_disabled) {
      return res.status(403).json({
        code: "POS_SESSION_ENDED",
        message: "This branch has been disabled. Ask the owner to enable it to use the POS.",
      });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Unable to check POS branch." });
  }

  req.pos = payload;
  return next();
}

app.get("/api/health", async (_req, res) => {
  const result = await pool.query("SELECT NOW() AS now");
  res.json({ status: "ok", database: "CowFlo", time: result.rows[0].now });
});

app.post("/api/auth/signup", async (req, res) => {
  const {
    firstName,
    lastName,
    username,
    businessName,
    email,
    password,
    confirmPassword,
    accessKey,
    businessCode,
  } = req.body;
  const joinCode = String(businessCode || "").trim();

  if (
    !firstName ||
    !lastName ||
    !username ||
    !businessName ||
    !email ||
    !password ||
    !confirmPassword ||
    !accessKey
  ) {
    return res.status(400).json({ message: "All fields are required." });
  }

  if (accessKey !== ownerSignupKey) {
    return res.status(403).json({ message: "Sign-up pass is invalid." });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ message: "Passwords do not match." });
  }

  if (password.length < 8) {
    return res.status(400).json({ message: "Password must be at least 8 characters." });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const normalizedUsername = String(username).trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, 10);
  const cleanFirstName = capitalizeWords(firstName.trim());
  const cleanLastName = capitalizeWords(lastName.trim());
  const fullName = `${cleanFirstName} ${cleanLastName}`;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    let cleanBusinessName = capitalizeWords(businessName.trim());
    const existingBusiness = await client.query(
      "SELECT id, name, business_id_code FROM businesses WHERE LOWER(name) = LOWER($1) LIMIT 1",
      [cleanBusinessName],
    );
    let businessId = existingBusiness.rows[0]?.id;
    let role = "owner";

    if (joinCode) {
      const business = existingBusiness.rows[0];

      if (!business || String(business.business_id_code || "").toUpperCase() !== joinCode.toUpperCase()) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "That business name and business code do not match." });
      }

      cleanBusinessName = business.name;
      role = "member";
    } else if (businessId) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        message: "A business with that name already exists. Enter its Business Code to join it, or use another name.",
      });
    }

    if (!businessId) {
      const newBusiness = (
        await client.query(
          "INSERT INTO businesses (name, status) VALUES ($1, 'A') RETURNING id",
          [cleanBusinessName],
        )
      ).rows[0];

      businessId = newBusiness.id;
      await client.query(
        "UPDATE businesses SET business_id_code = $1, updated_at = NOW() WHERE id = $2",
        [generateBusinessIdCode(cleanBusinessName, businessId), businessId],
      );
    } else if (!existingBusiness.rows[0].business_id_code) {
      await client.query(
        "UPDATE businesses SET business_id_code = $1, updated_at = NOW() WHERE id = $2",
        [generateBusinessIdCode(cleanBusinessName, businessId), businessId],
      );
    }

    const result = await client.query(
      `
        INSERT INTO users (
          name,
          first_name,
          last_name,
          username,
          business_id,
          business_name,
          email,
          password_hash,
          role,
          permissions
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id, name, first_name, last_name, username, business_id, business_name, email, role,
          permissions, created_at,
          (SELECT business_id_code FROM businesses WHERE businesses.id = users.business_id) AS business_id_code,
          (SELECT logo_image FROM businesses WHERE businesses.id = users.business_id) AS logo_image,
          (SELECT low_stock_threshold FROM businesses WHERE businesses.id = users.business_id) AS low_stock_threshold
      `,
      [
        fullName,
        cleanFirstName,
        cleanLastName,
        normalizedUsername,
        businessId,
        cleanBusinessName,
        normalizedEmail,
        passwordHash,
        role,
        role === "owner" ? null : JSON.stringify(defaultMemberPermissions),
      ],
    );

    await client.query("COMMIT");

    const user = result.rows[0];
    const token = createToken(user);

    return res.status(201).json({ token, user: serializeUser(user) });
  } catch (error) {
    await client.query("ROLLBACK");

    if (error.code === "23505") {
      return res.status(409).json({ message: "That email or username is already in use." });
    }

    console.error(error);
    return res.status(500).json({ message: "Unable to create account." });
  } finally {
    client.release();
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: "Username and password are required." });
  }

  try {
    const result = await pool.query(
      `
        SELECT users.id, users.name, users.first_name, users.last_name, users.username,
          users.business_id, users.business_name, businesses.business_id_code, businesses.logo_image,
          businesses.low_stock_threshold, users.email, users.profile_image, users.banner_image, users.role,
          users.permissions, users.password_hash
        FROM users
        LEFT JOIN businesses ON businesses.id = users.business_id
        WHERE LOWER(username) = $1
      `,
      [String(username).trim().toLowerCase()],
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ message: "Invalid username or password." });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatches) {
      return res.status(401).json({ message: "Invalid username or password." });
    }

    const token = createToken(user);

    return res.json({
      token,
      user: serializeUser(user),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Unable to sign in." });
  }
});

app.get("/api/me", authenticate, async (req, res) => {
  try {
    const result = await pool.query(userProfileSelect, [req.user.sub]);

    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    return res.json({ user: serializeUser(user) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Unable to load profile." });
  }
});

for (const [path, column, label] of [
  ["profile-image", "profile_image", "profile picture"],
  ["banner-image", "banner_image", "banner image"],
]) {
  app.put(`/api/me/${path}`, authenticate, requireAccess((a) => a.permissions.accountSettings), async (req, res) => {
    const image = normalizeImageData(req.body.image);

    if (!image.ok) {
      return res.status(400).json({ message: "Upload a PNG, JPG, WEBP, or GIF image under 2 MB." });
    }

    try {
      await pool.query(`UPDATE users SET ${column} = $1 WHERE id = $2`, [image.value, req.user.sub]);
      const result = await pool.query(userProfileSelect, [req.user.sub]);

      return res.json({ user: serializeUser(result.rows[0]) });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: `Unable to update ${label}.` });
    }
  });
}

app.put("/api/me/account", authenticate, requireAccess((a) => a.permissions.accountSettings), async (req, res) => {
  const firstName = capitalizeWords(String(req.body.firstName || "").trim());
  const lastName = capitalizeWords(String(req.body.lastName || "").trim());
  const username = String(req.body.username || "").trim().toLowerCase();
  const email = String(req.body.email || "").trim().toLowerCase();

  if (!firstName || !lastName || !username || !email) {
    return res.status(400).json({ message: "First name, last name, username, and email are required." });
  }

  if (!/^[a-z0-9._-]{3,120}$/.test(username)) {
    return res.status(400).json({
      message: "Username must be 3+ characters using letters, numbers, dots, dashes, or underscores.",
    });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ message: "Enter a valid email address." });
  }

  try {
    await pool.query(
      `
        UPDATE users
        SET first_name = $1, last_name = $2, name = $3, username = $4, email = $5
        WHERE id = $6
      `,
      [firstName, lastName, `${firstName} ${lastName}`, username, email, req.user.sub],
    );
    const result = await pool.query(userProfileSelect, [req.user.sub]);

    return res.json({ user: serializeUser(result.rows[0]) });
  } catch (error) {
    if (error.code === "23505") {
      const field = String(error.constraint || "").includes("email") ? "email" : "username";

      return res.status(409).json({ message: `That ${field} is already in use.` });
    }

    console.error(error);
    return res.status(500).json({ message: "Unable to update account." });
  }
});

const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const mailTransport = smtpConfigured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT || 587) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;
const mailFrom = process.env.MAIL_FROM || `CowFlo <${process.env.SMTP_USER}>`;
const passwordResetLifetimeMs = 30 * 60 * 1000;
const passwordResetCooldownMs = 60 * 1000;
// Links in emails always point at our own site, never at a request header an attacker could set.
const appUrl = (process.env.APP_URL || configuredCorsOrigins[0] || "http://localhost:3000").replace(/\/+$/, "");

function hashResetToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

function escapeEmailHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function verifyCurrentPassword(userId, password) {
  if (!password) {
    return false;
  }

  const result = await pool.query("SELECT password_hash FROM users WHERE id = $1", [userId]);

  return Boolean(result.rows[0]) && bcrypt.compare(String(password), result.rows[0].password_hash);
}

// Emails a one-time reset link. Returns "cooldown" if a link was sent less than a minute ago.
async function sendPasswordResetLink(user) {
  const activeExpiresAt = user.password_reset_expires_at ? new Date(user.password_reset_expires_at).getTime() : 0;

  if (activeExpiresAt - passwordResetLifetimeMs + passwordResetCooldownMs > Date.now()) {
    return "cooldown";
  }

  const token = randomBytes(32).toString("hex");
  const link = `${appUrl}/reset-password?token=${token}`;
  const displayName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.name;

  await pool.query(
    "UPDATE users SET password_reset_hash = $1, password_reset_expires_at = $2 WHERE id = $3",
    [hashResetToken(token), new Date(Date.now() + passwordResetLifetimeMs), user.id],
  );

  if (!mailTransport) {
    console.log(`[password reset] SMTP is not set up. Reset link for ${user.email}: ${link}`);
    return "logged";
  }

  try {
    await mailTransport.sendMail({
      from: mailFrom,
      to: user.email,
      subject: "Reset your CowFlo password",
      text: [
        `Hi ${displayName},`,
        "",
        "Open this link to set a new CowFlo password:",
        link,
        "",
        "The link works once and expires in 30 minutes.",
        "",
        "If you did not ask for this, you can ignore this email. Your password stays the same.",
      ].join("\n"),
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#111">
          <h2 style="margin:0 0 16px">Reset your CowFlo password</h2>
          <p>Hi ${escapeEmailHtml(displayName)},</p>
          <p>Click the button below to set a new password.</p>
          <p style="text-align:center;margin:28px 0">
            <a href="${escapeEmailHtml(link)}" style="display:inline-block;background:#63e050;color:#000;font-weight:bold;text-decoration:none;padding:14px 28px;border-radius:12px">Set a new password</a>
          </p>
          <p style="font-size:13px;color:#555">Or paste this link into your browser:<br><span style="word-break:break-all">${escapeEmailHtml(link)}</span></p>
          <p>The link works once and expires in <b>30 minutes</b>.</p>
          <p style="color:#555">If you did not ask for this, you can ignore this email. Your password stays the same.</p>
        </div>
      `,
    });
  } catch (error) {
    await pool.query("UPDATE users SET password_reset_hash = NULL, password_reset_expires_at = NULL WHERE id = $1", [
      user.id,
    ]);
    throw error;
  }

  return "sent";
}

const passwordResetUserColumns = "id, email, first_name, last_name, name, password_reset_expires_at";

app.post("/api/me/password/forgot", authenticate, requireAccess((a) => a.permissions.accountSettings), async (req, res) => {
  try {
    const userResult = await pool.query(`SELECT ${passwordResetUserColumns} FROM users WHERE id = $1`, [req.user.sub]);
    const user = userResult.rows[0];

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const outcome = await sendPasswordResetLink(user);

    if (outcome === "cooldown") {
      return res.status(429).json({ message: "A reset link was just sent. Check your email, or wait a minute to send another." });
    }

    return res.json({
      email: user.email,
      message:
        outcome === "logged"
          ? "Email is not set up on this server, so the reset link was printed in the server log."
          : `We sent a reset link to ${user.email}.`,
    });
  } catch (error) {
    console.error(error);
    return res.status(502).json({ message: "Unable to send the reset email. Try again later." });
  }
});

app.post("/api/auth/password-reset/request", async (req, res) => {
  const identifier = String(req.body.identifier || "").trim().toLowerCase();

  if (!identifier) {
    return res.status(400).json({ message: "Enter your email or username." });
  }

  // Same answer whether or not the account exists, so this can't be used to look up accounts.
  const genericMessage = "If that account exists, we sent a reset link to its email.";

  try {
    const userResult = await pool.query(
      `SELECT ${passwordResetUserColumns} FROM users WHERE LOWER(email) = $1 OR LOWER(username) = $1 LIMIT 1`,
      [identifier],
    );

    if (userResult.rows[0]) {
      await sendPasswordResetLink(userResult.rows[0]);
    }

    return res.json({ message: genericMessage });
  } catch (error) {
    console.error(error);
    return res.status(502).json({ message: "Unable to send the reset email. Try again later." });
  }
});

async function findUserByResetToken(token) {
  if (!/^[a-f0-9]{64}$/.test(String(token || ""))) {
    return null;
  }

  const result = await pool.query(
    `
      SELECT id, email
      FROM users
      WHERE password_reset_hash = $1 AND password_reset_expires_at > NOW()
    `,
    [hashResetToken(token)],
  );

  return result.rows[0] || null;
}

app.get("/api/auth/password-reset/verify", async (req, res) => {
  try {
    const user = await findUserByResetToken(req.query.token);

    if (!user) {
      return res.status(400).json({ message: "This reset link is invalid or has expired. Ask for a new one." });
    }

    return res.json({ email: user.email });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Unable to check the reset link." });
  }
});

app.post("/api/auth/password-reset/confirm", async (req, res) => {
  const { token, password, confirmPassword } = req.body;

  if (!password || !confirmPassword) {
    return res.status(400).json({ message: "Fill in both password fields." });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ message: "Passwords do not match." });
  }

  if (String(password).length < 8) {
    return res.status(400).json({ message: "Password must be at least 8 characters." });
  }

  try {
    const user = await findUserByResetToken(token);

    if (!user) {
      return res.status(400).json({ message: "This reset link is invalid or has expired. Ask for a new one." });
    }

    await pool.query(
      `
        UPDATE users
        SET password_hash = $1, password_reset_hash = NULL, password_reset_expires_at = NULL
        WHERE id = $2
      `,
      [await bcrypt.hash(String(password), 10), user.id],
    );

    return res.json({ message: "Your password was changed. Sign in with your new password." });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Unable to change the password." });
  }
});

app.put("/api/me/password", authenticate, requireAccess((a) => a.permissions.accountSettings), async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;

  if (!currentPassword || !newPassword || !confirmPassword) {
    return res.status(400).json({ message: "Fill in all password fields." });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({ message: "New passwords do not match." });
  }

  if (String(newPassword).length < 8) {
    return res.status(400).json({ message: "New password must be at least 8 characters." });
  }

  try {
    const userResult = await pool.query("SELECT password_hash FROM users WHERE id = $1", [req.user.sub]);
    const user = userResult.rows[0];

    if (!user || !(await bcrypt.compare(String(currentPassword), user.password_hash))) {
      return res.status(400).json({ message: "Current password is incorrect." });
    }

    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
      await bcrypt.hash(String(newPassword), 10),
      req.user.sub,
    ]);

    return res.json({ message: "Password updated." });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Unable to update password." });
  }
});

app.put("/api/me/business/settings", authenticate, requireAccess((a) => a.permissions.businessSettings), async (req, res) => {
  const threshold = Number(req.body.lowStockThreshold);

  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 100000) {
    return res.status(400).json({ message: "Low stock level must be a whole number from 0 up." });
  }

  try {
    const businessId = await getCurrentBusinessId(req.user.sub);

    await pool.query("UPDATE businesses SET low_stock_threshold = $1, updated_at = NOW() WHERE id = $2", [
      threshold,
      businessId,
    ]);
    const result = await pool.query(userProfileSelect, [req.user.sub]);

    return res.json({ user: serializeUser(result.rows[0]) });
  } catch (error) {
    console.error(error);
    return res.status(error.status || 500).json({ message: error.status ? error.message : "Unable to save settings." });
  }
});

app.put("/api/me/business", authenticate, requireAccess((a) => a.permissions.businessSettings), async (req, res) => {
  const businessName = capitalizeWords(String(req.body.businessName || "").trim());

  if (!businessName) {
    return res.status(400).json({ message: "Business name is required." });
  }

  if (businessName.length > 160) {
    return res.status(400).json({ message: "Business name must be 160 characters or fewer." });
  }

  try {
    if (!(await verifyCurrentPassword(req.user.sub, req.body.password))) {
      return res.status(400).json({ message: "Password is incorrect." });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Unable to update business." });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const businessResult = await client.query(
      `
        SELECT businesses.id, businesses.name, businesses.business_id_code
        FROM users
        JOIN businesses ON businesses.id = users.business_id
        WHERE users.id = $1
        FOR UPDATE OF businesses
      `,
      [req.user.sub],
    );
    const business = businessResult.rows[0];

    if (!business) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "No business is linked to this account." });
    }

    const duplicateName = await client.query(
      "SELECT 1 FROM businesses WHERE LOWER(name) = LOWER($1) AND id <> $2 LIMIT 1",
      [businessName, business.id],
    );

    if (duplicateName.rowCount > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Another business already uses that name." });
    }

    let businessCode = business.business_id_code;

    if (businessName.toLowerCase() !== String(business.name).toLowerCase() || !businessCode) {
      const baseCode = generateBusinessIdCode(businessName, business.id);
      businessCode = baseCode;

      for (let attempt = 2; ; attempt += 1) {
        const taken = await client.query(
          "SELECT 1 FROM businesses WHERE UPPER(business_id_code) = UPPER($1) AND id <> $2 LIMIT 1",
          [businessCode, business.id],
        );

        if (taken.rowCount === 0) {
          break;
        }

        businessCode = `${baseCode}${attempt}`;
      }
    }

    await client.query(
      "UPDATE businesses SET name = $1, business_id_code = $2, updated_at = NOW() WHERE id = $3",
      [businessName, businessCode, business.id],
    );
    await client.query("UPDATE users SET business_name = $1 WHERE business_id = $2", [
      businessName,
      business.id,
    ]);
    await client.query("COMMIT");

    const result = await pool.query(userProfileSelect, [req.user.sub]);

    return res.json({ user: serializeUser(result.rows[0]) });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    return res.status(500).json({ message: "Unable to update business." });
  } finally {
    client.release();
  }
});

app.put("/api/me/business-logo", authenticate, requireAccess((a) => a.permissions.businessSettings), async (req, res) => {
  const image = normalizeImageData(req.body.image);

  if (!image.ok) {
    return res.status(400).json({ message: "Upload a PNG, JPG, WEBP, or GIF image under 2 MB." });
  }

  try {
    const updateResult = await pool.query(
      `
        UPDATE businesses
        SET logo_image = $1, updated_at = NOW()
        WHERE id = (SELECT business_id FROM users WHERE id = $2)
      `,
      [image.value, req.user.sub],
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ message: "No business is linked to this account." });
    }

    const result = await pool.query(userProfileSelect, [req.user.sub]);

    return res.json({ user: serializeUser(result.rows[0]) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Unable to update business logo." });
  }
});

app.get("/api/accounts", authenticate, requireAccess((a) => a.permissions.manageAccounts), async (req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT id, first_name, last_name, name, username, email, role, permissions, profile_image, created_at
        FROM users
        WHERE business_id = $1
        ORDER BY (role = 'owner') DESC, created_at ASC, id ASC
      `,
      [req.access.businessId],
    );

    return res.json({
      accounts: result.rows.map((user) => ({
        id: user.id,
        name: capitalizeWords([user.first_name, user.last_name].filter(Boolean).join(" ") || user.name),
        username: capitalizeWords(user.username),
        email: user.email,
        role: user.role,
        permissions: getEffectivePermissions(user),
        profileImage: user.profile_image || null,
        createdAt: user.created_at,
        isSelf: user.id === req.access.userId,
      })),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Unable to load accounts." });
  }
});

app.put("/api/accounts/:id/permissions", authenticate, requireAccess((a) => a.permissions.manageAccounts), async (req, res) => {
  const accountId = Number(req.params.id);

  if (!Number.isInteger(accountId) || accountId <= 0) {
    return res.status(400).json({ message: "Select a valid account." });
  }

  if (accountId === req.access.userId) {
    return res.status(400).json({ message: "You cannot change your own access." });
  }

  try {
    const targetResult = await pool.query("SELECT id, role FROM users WHERE id = $1 AND business_id = $2", [
      accountId,
      req.access.businessId,
    ]);
    const target = targetResult.rows[0];

    if (!target) {
      return res.status(404).json({ message: "Account not found in this business." });
    }

    if (target.role === "owner") {
      return res.status(400).json({ message: "The owner always has full access." });
    }

    const permissions = normalizePermissions(req.body.permissions);

    if (permissions.branchAccess.branchIds.length > 0) {
      const branchResult = await pool.query(
        "SELECT id FROM branches WHERE business_id = $1 AND id = ANY($2::int[])",
        [req.access.businessId, permissions.branchAccess.branchIds],
      );
      permissions.branchAccess.branchIds = branchResult.rows.map((row) => row.id);
    }

    await pool.query("UPDATE users SET permissions = $1 WHERE id = $2", [JSON.stringify(permissions), accountId]);

    return res.json({ permissions });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Unable to save access." });
  }
});

app.get("/api/branches", authenticate, requireAccess(() => true), async (req, res) => {
  try {
    const businessId = await getCurrentBusinessId(req.user.sub);
    const result = await pool.query(
      `
        SELECT id, business_id, name, details, pos_code, is_disabled, sort_order, created_at, updated_at
        FROM branches
        WHERE business_id = $1 AND ($2::int[] IS NULL OR id = ANY($2::int[]))
        ORDER BY sort_order ASC, id ASC
      `,
      [businessId, req.access.allowedBranchIds],
    );

    return res.json({ branches: result.rows.map(serializeBranch) });
  } catch (error) {
    console.error(error);
    return res.status(error.status || 500).json({ message: error.message || "Unable to load branches." });
  }
});

app.post("/api/branches", authenticate, requireAccess((a) => a.permissions.sections.branches && hasAllBranches(a)), async (req, res) => {
  const { name, details, posCode } = req.body;
  const validationMessage = validateBranchFields({ name, details, posCode });

  if (validationMessage) {
    return res.status(400).json({ message: validationMessage });
  }

  try {
    const businessId = await getCurrentBusinessId(req.user.sub);

    if (await isPosCodeTaken(businessId, posCode)) {
      return res.status(409).json({ message: "Another branch already uses that POS code." });
    }

    const result = await pool.query(
      `
        INSERT INTO branches (user_id, business_id, name, details, pos_code, sort_order)
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          COALESCE((SELECT MAX(sort_order) + 1 FROM branches WHERE business_id = $2), 1)
        )
        RETURNING id, business_id, name, details, pos_code, is_disabled, sort_order, created_at, updated_at
      `,
      [
        req.user.sub,
        businessId,
        String(name).trim(),
        String(details || "").trim() || null,
        String(posCode).trim(),
      ],
    );

    return res.status(201).json({ branch: serializeBranch(result.rows[0]) });
  } catch (error) {
    console.error(error);
    return res.status(error.status || 500).json({ message: error.message || "Unable to create branch." });
  }
});

app.patch("/api/branches/:id", authenticate, requireAccess((a, req) => (a.permissions.sections.branches || a.permissions.businessSettings) && canAccessBranch(a, req.params.id)), async (req, res) => {
  const { name, details, posCode } = req.body;
  const validationMessage = validateBranchFields({ name, details, posCode });

  if (validationMessage) {
    return res.status(400).json({ message: validationMessage });
  }

  try {
    const businessId = await getCurrentBusinessId(req.user.sub);

    if (await isPosCodeTaken(businessId, posCode, Number(req.params.id) || 0)) {
      return res.status(409).json({ message: "Another branch already uses that POS code." });
    }

    const result = await pool.query(
      `
        UPDATE branches
        SET name = $1,
            details = $2,
            pos_code = $3,
            updated_at = NOW()
        WHERE id = $4 AND business_id = $5
        RETURNING id, business_id, name, details, pos_code, is_disabled, sort_order, created_at, updated_at
      `,
      [
        String(name).trim(),
        String(details || "").trim() || null,
        String(posCode).trim(),
        req.params.id,
        businessId,
      ],
    );

    if (!result.rows[0]) {
      return res.status(404).json({ message: "Branch not found." });
    }

    return res.json({ branch: serializeBranch(result.rows[0]) });
  } catch (error) {
    console.error(error);
    return res.status(error.status || 500).json({ message: error.message || "Unable to update branch." });
  }
});

app.patch("/api/branches/:id/disable", authenticate, requireAccess((a, req) => a.permissions.sections.branches && canAccessBranch(a, req.params.id)), async (req, res) => {
  const isDisabled = Boolean(req.body.isDisabled);

  try {
    const businessId = await getCurrentBusinessId(req.user.sub);
    const result = await pool.query(
      `
        UPDATE branches
        SET is_disabled = $1,
            updated_at = NOW()
        WHERE id = $2 AND business_id = $3
        RETURNING id, business_id, name, details, pos_code, is_disabled, sort_order, created_at, updated_at
      `,
      [isDisabled, req.params.id, businessId],
    );

    if (!result.rows[0]) {
      return res.status(404).json({ message: "Branch not found." });
    }

    return res.json({ branch: serializeBranch(result.rows[0]) });
  } catch (error) {
    console.error(error);
    return res.status(error.status || 500).json({ message: error.message || "Unable to update branch status." });
  }
});

app.patch("/api/branches/:id/sort", authenticate, requireAccess((a) => a.permissions.sections.branches && hasAllBranches(a)), async (req, res) => {
  const direction = req.body.direction === "down" ? "down" : "up";
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const businessId = await getCurrentBusinessId(req.user.sub, client);

    const currentResult = await client.query(
      `
        SELECT id, sort_order
        FROM branches
        WHERE id = $1 AND business_id = $2
        FOR UPDATE
      `,
      [req.params.id, businessId],
    );
    const current = currentResult.rows[0];

    if (!current) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Branch not found." });
    }

    const neighborOperator = direction === "down" ? ">" : "<";
    const neighborOrder = direction === "down" ? "ASC" : "DESC";
    const neighborResult = await client.query(
      `
        SELECT id, sort_order
        FROM branches
        WHERE business_id = $1 AND sort_order ${neighborOperator} $2
        ORDER BY sort_order ${neighborOrder}, id ${neighborOrder}
        LIMIT 1
        FOR UPDATE
      `,
      [businessId, current.sort_order],
    );
    const neighbor = neighborResult.rows[0];

    if (neighbor) {
      await client.query(
        `
          UPDATE branches
          SET sort_order = CASE
            WHEN id = $1 THEN $2
            WHEN id = $3 THEN $4
            ELSE sort_order
          END,
          updated_at = NOW()
          WHERE business_id = $5 AND id IN ($1, $3)
        `,
        [current.id, neighbor.sort_order, neighbor.id, current.sort_order, businessId],
      );
    }

    const branchesResult = await client.query(
      `
        SELECT id, business_id, name, details, pos_code, is_disabled, sort_order, created_at, updated_at
        FROM branches
        WHERE business_id = $1
        ORDER BY sort_order ASC, id ASC
      `,
      [businessId],
    );

    await client.query("COMMIT");
    return res.json({ branches: branchesResult.rows.map(serializeBranch) });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    return res.status(error.status || 500).json({ message: error.message || "Unable to sort branches." });
  } finally {
    client.release();
  }
});

app.delete("/api/branches/:id", authenticate, requireAccess((a) => a.permissions.sections.branches && hasAllBranches(a)), async (req, res) => {
  const posCode = String(req.body?.posCode || "").trim();

  if (!posCode) {
    return res.status(400).json({ message: "Enter the branch's POS code to delete it." });
  }

  try {
    const businessId = await getCurrentBusinessId(req.user.sub);
    const branchResult = await pool.query("SELECT pos_code FROM branches WHERE id = $1 AND business_id = $2", [
      req.params.id,
      businessId,
    ]);

    if (!branchResult.rows[0]) {
      return res.status(404).json({ message: "Branch not found." });
    }

    if (branchResult.rows[0].pos_code !== posCode) {
      return res.status(400).json({ message: "That POS code is incorrect. The branch was not deleted." });
    }

    await pool.query("DELETE FROM branches WHERE id = $1 AND business_id = $2", [req.params.id, businessId]);

    return res.json({ message: "Branch removed forever." });
  } catch (error) {
    console.error(error);
    return res.status(error.status || 500).json({ message: error.message || "Unable to remove branch." });
  }
});

app.get("/api/inventory", authenticate, requireAccess((a, req) => (a.permissions.sections.inventory || a.permissions.sections.branches) && (!req.query.branchId || req.query.branchId === "all" || canAccessBranch(a, req.query.branchId))), async (req, res) => {
  try {
    const businessId = await getCurrentBusinessId(req.user.sub);
    const branchId = req.query.branchId;
    const searchTerm = String(req.query.search || "").trim();
    const params = [businessId];
    let branchFilter = "";
    let inventoryBranchJoinFilter = "";
    let searchFilter = "";

    if (branchId && branchId !== "all") {
      const selectedBranchId = Number(branchId);

      if (!Number.isInteger(selectedBranchId) || selectedBranchId <= 0) {
        return res.status(400).json({ message: "Select a valid branch." });
      }

      params.push(selectedBranchId);
      inventoryBranchJoinFilter = "AND inventory_item_branches.branch_id = $2";
      branchFilter = `
        AND EXISTS (
          SELECT 1
          FROM inventory_item_branches selected_branch
          JOIN branches selected_branch_record ON selected_branch_record.id = selected_branch.branch_id
          WHERE selected_branch.inventory_item_id = inventory_items.id
            AND selected_branch.branch_id = $2
            AND selected_branch_record.business_id = $1
        )
      `;
    } else if (req.access.allowedBranchIds !== null) {
      params.push(req.access.allowedBranchIds);
      inventoryBranchJoinFilter = "AND inventory_item_branches.branch_id = ANY($2::int[])";
      branchFilter = `
        AND EXISTS (
          SELECT 1
          FROM inventory_item_branches allowed_branch
          WHERE allowed_branch.inventory_item_id = inventory_items.id
            AND allowed_branch.branch_id = ANY($2::int[])
        )
      `;
    }

    if (searchTerm) {
      params.push(`%${searchTerm}%`);
      const searchParamIndex = params.length;

      searchFilter = `
        AND (
          inventory_items.name ILIKE $${searchParamIndex}
          OR CAST(inventory_items.id AS TEXT) ILIKE $${searchParamIndex}
        )
      `;
    }

    const result = await pool.query(
      `
        SELECT
          inventory_items.id,
          inventory_items.business_id,
          inventory_items.name,
          inventory_items.stocks,
          inventory_items.price,
          COALESCE(MAX(inventory_item_branches.assigned_stocks), 0) AS branch_stock,
          inventory_items.sort_order,
          inventory_items.image_data,
          inventory_items.image_mime,
          inventory_items.image_name,
          inventory_items.created_at,
          inventory_items.updated_at,
          COALESCE(
            JSON_AGG(
              JSON_BUILD_OBJECT(
                'id', branches.id,
                'name', branches.name,
                'stocks', inventory_item_branches.assigned_stocks
              )
              ORDER BY branches.sort_order ASC, branches.id ASC
            ) FILTER (WHERE branches.id IS NOT NULL),
            '[]'
          ) AS branches
        FROM inventory_items
        LEFT JOIN inventory_item_branches
          ON inventory_item_branches.inventory_item_id = inventory_items.id
          ${inventoryBranchJoinFilter}
        LEFT JOIN branches ON branches.id = inventory_item_branches.branch_id
        WHERE inventory_items.business_id = $1
          ${branchFilter}
          ${searchFilter}
        GROUP BY inventory_items.id
        ORDER BY LOWER(inventory_items.name) ASC, inventory_items.id ASC
      `,
      params,
    );

    return res.json({ inventoryItems: result.rows.map(serializeInventoryItem) });
  } catch (error) {
    console.error(error);
    return res.status(error.status || 500).json({ message: error.message || "Unable to load inventory." });
  }
});

app.post("/api/inventory", authenticate, requireAccess((a) => a.permissions.sections.inventory && hasAllBranches(a)), async (req, res) => {
  const { name, stocks, price, branchAllocations, imageData, imageMime, imageName } = req.body;
  const validationMessage = validateInventoryFields({ name, stocks, price, branchAllocations });
  const imageValidationMessage = validateInventoryImage({ imageData, imageMime });

  if (validationMessage) {
    return res.status(400).json({ message: validationMessage });
  }

  if (imageValidationMessage) {
    return res.status(400).json({ message: imageValidationMessage });
  }

  const stockCount = Number(stocks);
  const itemPrice = Number(price);
  const allocationMap = new Map();

  branchAllocations.forEach((allocation) => {
    allocationMap.set(Number(allocation.branchId), Number(allocation.stocks));
  });

  const uniqueBranchIds = [...allocationMap.keys()];
  const assignedStocks = uniqueBranchIds.map((branchId) => allocationMap.get(branchId));

  if (uniqueBranchIds.length === 0) {
    return res.status(400).json({ message: "Select at least one branch." });
  }

  if (assignedStocks.reduce((total, value) => total + value, 0) !== stockCount) {
    return res.status(400).json({ message: "All stocks must be assigned before saving." });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const businessId = await getCurrentBusinessId(req.user.sub, client);
    const branchesResult = await client.query(
      `
        SELECT id
        FROM branches
        WHERE business_id = $1 AND id = ANY($2::int[])
      `,
      [businessId, uniqueBranchIds],
    );

    if (branchesResult.rows.length !== uniqueBranchIds.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Select valid branches for this business." });
    }

    const itemResult = await client.query(
      `
        INSERT INTO inventory_items (business_id, name, stocks, price, sort_order, image_data, image_mime, image_name, created_by)
        VALUES (
          $1,
          $2,
          $3,
          $4,
          COALESCE((SELECT MAX(sort_order) + 1 FROM inventory_items WHERE business_id = $1), 1),
          $5,
          $6,
          $7,
          $8
        )
        RETURNING id, business_id, name, stocks, price, sort_order, image_data, image_mime, image_name, created_at, updated_at
      `,
      [
        businessId,
        String(name).trim(),
        stockCount,
        itemPrice,
        imageData || null,
        imageMime || null,
        imageName ? String(imageName).trim() : null,
        req.user.sub,
      ],
    );
    const item = itemResult.rows[0];

    await client.query(
      `
        INSERT INTO inventory_item_branches (inventory_item_id, branch_id, assigned_stocks)
        SELECT $1, branch_id, assigned_stock
        FROM UNNEST($2::int[], $3::int[]) AS allocations(branch_id, assigned_stock)
      `,
      [item.id, uniqueBranchIds, assignedStocks],
    );

    await client.query(
      `
        INSERT INTO inventory_stock_history (inventory_item_id, branch_id, action, quantity, created_by)
        SELECT $1, branch_id, 'add', assigned_stock, $4
        FROM UNNEST($2::int[], $3::int[]) AS allocations(branch_id, assigned_stock)
      `,
      [item.id, uniqueBranchIds, assignedStocks, req.user.sub],
    );

    await client.query(
      `
        INSERT INTO inventory_price_history (inventory_item_id, old_price, new_price, created_by)
        VALUES ($1, NULL, $2, $3)
      `,
      [item.id, itemPrice, req.user.sub],
    );

    const fullItemResult = await client.query(
      `
        SELECT
          inventory_items.id,
          inventory_items.business_id,
          inventory_items.name,
          inventory_items.stocks,
          inventory_items.price,
          inventory_items.sort_order,
          inventory_items.image_data,
          inventory_items.image_mime,
          inventory_items.image_name,
          inventory_items.created_at,
          inventory_items.updated_at,
          COALESCE(
            JSON_AGG(
              JSON_BUILD_OBJECT(
                'id', branches.id,
                'name', branches.name,
                'stocks', inventory_item_branches.assigned_stocks
              )
              ORDER BY branches.sort_order ASC, branches.id ASC
            ) FILTER (WHERE branches.id IS NOT NULL),
            '[]'
          ) AS branches
        FROM inventory_items
        LEFT JOIN inventory_item_branches ON inventory_item_branches.inventory_item_id = inventory_items.id
        LEFT JOIN branches ON branches.id = inventory_item_branches.branch_id
        WHERE inventory_items.id = $1 AND inventory_items.business_id = $2
        GROUP BY inventory_items.id
      `,
      [item.id, businessId],
    );

    await client.query("COMMIT");
    return res.status(201).json({ inventoryItem: serializeInventoryItem(fullItemResult.rows[0]) });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    return res.status(error.status || 500).json({ message: error.message || "Unable to add inventory item." });
  } finally {
    client.release();
  }
});

app.patch("/api/inventory/sort", authenticate, requireAccess((a) => a.permissions.sections.inventory && hasAllBranches(a)), async (req, res) => {
  const orderedIds = Array.isArray(req.body.orderedIds)
    ? req.body.orderedIds.map((id) => Number(id))
    : [];

  if (
    orderedIds.length === 0 ||
    orderedIds.some((id) => !Number.isInteger(id) || id <= 0) ||
    new Set(orderedIds).size !== orderedIds.length
  ) {
    return res.status(400).json({ message: "Select a valid inventory order." });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const businessId = await getCurrentBusinessId(req.user.sub, client);
    const itemsResult = await client.query(
      `
        SELECT id, sort_order
        FROM inventory_items
        WHERE business_id = $1 AND id = ANY($2::int[])
        ORDER BY sort_order ASC, id ASC
        FOR UPDATE
      `,
      [businessId, orderedIds],
    );

    if (itemsResult.rows.length !== orderedIds.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Select valid inventory items for this business." });
    }

    await client.query(
      `
        UPDATE inventory_items
        SET sort_order = sorted_items.sort_order,
            updated_at = NOW()
        FROM UNNEST($1::int[], $2::int[]) AS sorted_items(id, sort_order)
        WHERE inventory_items.id = sorted_items.id
          AND inventory_items.business_id = $3
      `,
      [orderedIds, itemsResult.rows.map((item) => item.sort_order), businessId],
    );

    await client.query("COMMIT");
    return res.json({ message: "Inventory order updated." });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    return res.status(error.status || 500).json({ message: error.message || "Unable to sort inventory." });
  } finally {
    client.release();
  }
});

app.patch("/api/inventory/:id", authenticate, requireAccess((a) => a.permissions.sections.inventory && hasAllBranches(a)), async (req, res) => {
  const itemId = Number(req.params.id);
  const { name, price, imageData, imageMime, imageName } = req.body;
  const imageValidationMessage = validateInventoryImage({ imageData, imageMime });
  const itemPrice = Number(price);

  if (!Number.isInteger(itemId) || itemId <= 0) {
    return res.status(400).json({ message: "Select a valid inventory item." });
  }

  if (!name || !String(name).trim()) {
    return res.status(400).json({ message: "Item name is required." });
  }

  if (
    price === "" ||
    price === null ||
    price === undefined ||
    !Number.isFinite(itemPrice) ||
    itemPrice < 0
  ) {
    return res.status(400).json({ message: "Price must be zero or greater." });
  }

  if (imageValidationMessage) {
    return res.status(400).json({ message: imageValidationMessage });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const businessId = await getCurrentBusinessId(req.user.sub, client);
    const currentResult = await client.query(
      "SELECT id, price FROM inventory_items WHERE id = $1 AND business_id = $2 FOR UPDATE",
      [itemId, businessId],
    );

    if (currentResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Inventory item not found." });
    }

    const oldPrice = Number(currentResult.rows[0].price || 0);
    const params = [itemId, businessId, String(name).trim(), itemPrice];
    let imageUpdate = "";

    if (Object.hasOwn(req.body, "imageData")) {
      params.push(imageData || null, imageMime || null, imageName ? String(imageName).trim() : null);
      imageUpdate = ", image_data = $5, image_mime = $6, image_name = $7";
    }

    await client.query(
      `
        UPDATE inventory_items
        SET name = $3,
            price = $4,
            updated_at = NOW()
            ${imageUpdate}
        WHERE id = $1 AND business_id = $2
        RETURNING id
      `,
      params,
    );

    if (oldPrice !== itemPrice) {
      await client.query(
        `
          INSERT INTO inventory_price_history (inventory_item_id, old_price, new_price, created_by)
          VALUES ($1, $2, $3, $4)
        `,
        [itemId, oldPrice, itemPrice, req.user.sub],
      );
    }

    await client.query("COMMIT");
    return res.json({ message: "Inventory item updated." });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    return res.status(error.status || 500).json({ message: error.message || "Unable to update inventory item." });
  } finally {
    client.release();
  }
});

app.delete("/api/inventory/:id", authenticate, requireAccess((a) => a.permissions.sections.inventory && hasAllBranches(a)), async (req, res) => {
  const itemId = Number(req.params.id);

  if (!Number.isInteger(itemId) || itemId <= 0) {
    return res.status(400).json({ message: "Select a valid inventory item." });
  }

  try {
    const businessId = await getCurrentBusinessId(req.user.sub);
    const result = await pool.query(
      "DELETE FROM inventory_items WHERE id = $1 AND business_id = $2 RETURNING id",
      [itemId, businessId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Inventory item not found." });
    }

    return res.json({ message: "Inventory item removed forever." });
  } catch (error) {
    console.error(error);
    return res.status(error.status || 500).json({ message: error.message || "Unable to remove inventory item." });
  }
});

app.post("/api/inventory/:id/stock", authenticate, requireAccess((a, req) => a.permissions.sections.inventory && getRequestedBranchIds(req.body).every((id) => canAccessBranch(a, id))), async (req, res) => {
  const itemId = Number(req.params.id);
  const mode = req.body.mode === "delete" ? "delete" : "add";
  const stockCount = validatePositiveIntegerStock(req.body.stocks);

  if (!Number.isInteger(itemId) || itemId <= 0) {
    return res.status(400).json({ message: "Select a valid inventory item." });
  }

  if (!stockCount) {
    return res.status(400).json({ message: "Enter a stock count greater than zero." });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const businessId = await getCurrentBusinessId(req.user.sub, client);
    const itemResult = await client.query(
      `
        SELECT id, stocks
        FROM inventory_items
        WHERE id = $1 AND business_id = $2
        FOR UPDATE
      `,
      [itemId, businessId],
    );

    if (itemResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Inventory item not found." });
    }

    if (mode === "add") {
      const rawAllocations = Array.isArray(req.body.branchAllocations)
        ? req.body.branchAllocations
        : [{ branchId: req.body.branchId, stocks: stockCount }];
      const allocationMap = new Map();

      rawAllocations.forEach((allocation) => {
        allocationMap.set(Number(allocation.branchId), Number(allocation.stocks));
      });

      const uniqueBranchIds = [...allocationMap.keys()];
      const assignedStocks = uniqueBranchIds.map((branchId) => allocationMap.get(branchId));
      const hasInvalidAllocation =
        uniqueBranchIds.length === 0 ||
        uniqueBranchIds.some((branchId) => !Number.isInteger(branchId) || branchId <= 0) ||
        assignedStocks.some((value) => !Number.isInteger(value) || value <= 0);
      const assignedTotal = assignedStocks.reduce((total, value) => total + value, 0);

      if (hasInvalidAllocation) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "Fill stocks for every selected branch." });
      }

      if (assignedTotal !== stockCount) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "All stocks must be assigned before saving." });
      }

      const branchesResult = await client.query(
        `
          SELECT id
          FROM branches
          WHERE business_id = $1 AND id = ANY($2::int[])
        `,
        [businessId, uniqueBranchIds],
      );

      if (branchesResult.rows.length !== uniqueBranchIds.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "Select valid branches for this business." });
      }

      await client.query(
        `
          UPDATE inventory_items
          SET stocks = stocks + $3,
              updated_at = NOW()
          WHERE id = $1 AND business_id = $2
        `,
        [itemId, businessId, stockCount],
      );

      await client.query(
        `
          INSERT INTO inventory_item_branches (inventory_item_id, branch_id, assigned_stocks)
          SELECT $1, branch_id, assigned_stock
          FROM UNNEST($2::int[], $3::int[]) AS allocations(branch_id, assigned_stock)
          ON CONFLICT (inventory_item_id, branch_id)
          DO UPDATE SET assigned_stocks = inventory_item_branches.assigned_stocks + EXCLUDED.assigned_stocks
        `,
        [itemId, uniqueBranchIds, assignedStocks],
      );

      await client.query(
        `
          INSERT INTO inventory_stock_history (inventory_item_id, branch_id, action, quantity, created_by)
          SELECT $1, branch_id, 'add', assigned_stock, $4
          FROM UNNEST($2::int[], $3::int[]) AS allocations(branch_id, assigned_stock)
        `,
        [itemId, uniqueBranchIds, assignedStocks, req.user.sub],
      );
    } else {
      const rawAllocations = Array.isArray(req.body.branchAllocations)
        ? req.body.branchAllocations
        : [{ branchId: req.body.branchId, stocks: stockCount }];
      const allocationMap = new Map();

      rawAllocations.forEach((allocation) => {
        allocationMap.set(Number(allocation.branchId), Number(allocation.stocks));
      });

      const uniqueBranchIds = [...allocationMap.keys()];
      const assignedStocks = uniqueBranchIds.map((branchId) => allocationMap.get(branchId));
      const hasInvalidAllocation =
        uniqueBranchIds.length === 0 ||
        uniqueBranchIds.some((branchId) => !Number.isInteger(branchId) || branchId <= 0) ||
        assignedStocks.some((value) => !Number.isInteger(value) || value <= 0);
      const assignedTotal = assignedStocks.reduce((total, value) => total + value, 0);

      if (hasInvalidAllocation) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "Fill stocks for every selected branch." });
      }

      if (assignedTotal !== stockCount) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "All stocks must be assigned before saving." });
      }

      const branchStockResult = await client.query(
        `
          SELECT
            inventory_item_branches.branch_id,
            inventory_item_branches.assigned_stocks
          FROM inventory_item_branches
          JOIN branches ON branches.id = inventory_item_branches.branch_id
          WHERE inventory_item_branches.inventory_item_id = $1
            AND inventory_item_branches.branch_id = ANY($2::int[])
            AND branches.business_id = $3
          FOR UPDATE
        `,
        [itemId, uniqueBranchIds, businessId],
      );

      if (branchStockResult.rows.length !== uniqueBranchIds.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "This item is not assigned to every selected branch." });
      }

      const currentStocksByBranch = new Map(
        branchStockResult.rows.map((row) => [Number(row.branch_id), Number(row.assigned_stocks)]),
      );
      const deletesMoreThanAvailable = uniqueBranchIds.some(
        (branchId) => allocationMap.get(branchId) > currentStocksByBranch.get(branchId),
      );

      if (deletesMoreThanAvailable) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "You cannot delete more than a branch has." });
      }

      await client.query(
        `
          UPDATE inventory_items
          SET stocks = stocks - $3,
              updated_at = NOW()
          WHERE id = $1 AND business_id = $2
        `,
        [itemId, businessId, stockCount],
      );

      await client.query(
        `
          UPDATE inventory_item_branches
          SET assigned_stocks = assigned_stocks - allocations.assigned_stock
          FROM UNNEST($2::int[], $3::int[]) AS allocations(branch_id, assigned_stock)
          WHERE inventory_item_branches.inventory_item_id = $1
            AND inventory_item_branches.branch_id = allocations.branch_id
        `,
        [itemId, uniqueBranchIds, assignedStocks],
      );

      await client.query(
        `
          DELETE FROM inventory_item_branches
          WHERE inventory_item_id = $1
            AND branch_id = ANY($2::int[])
            AND assigned_stocks <= 0
        `,
        [itemId, uniqueBranchIds],
      );

      await client.query(
        `
          INSERT INTO inventory_stock_history (inventory_item_id, branch_id, action, quantity, created_by)
          SELECT $1, branch_id, 'delete', assigned_stock, $4
          FROM UNNEST($2::int[], $3::int[]) AS allocations(branch_id, assigned_stock)
        `,
        [itemId, uniqueBranchIds, assignedStocks, req.user.sub],
      );
    }

    await client.query("COMMIT");
    return res.json({ message: "Inventory stock updated." });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    return res.status(error.status || 500).json({ message: error.message || "Unable to update inventory stock." });
  } finally {
    client.release();
  }
});

app.get("/api/inventory/:id/history", authenticate, requireAccess((a) => a.permissions.sections.inventory || a.permissions.sections.branches), async (req, res) => {
  const itemId = Number(req.params.id);
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 10, 1), 50);
  const stockPage = Math.max(Number.parseInt(req.query.stockPage, 10) || 1, 1);
  const pricePage = Math.max(Number.parseInt(req.query.pricePage, 10) || 1, 1);

  if (!Number.isInteger(itemId) || itemId <= 0) {
    return res.status(400).json({ message: "Select a valid inventory item." });
  }

  try {
    const businessId = await getCurrentBusinessId(req.user.sub);
    const itemResult = await pool.query(
      "SELECT id, name FROM inventory_items WHERE id = $1 AND business_id = $2",
      [itemId, businessId],
    );

    if (itemResult.rows.length === 0) {
      return res.status(404).json({ message: "Inventory item not found." });
    }

    const historyResult = await pool.query(
      `
        SELECT
          inventory_stock_history.id,
          inventory_stock_history.inventory_item_id,
          inventory_stock_history.branch_id,
          branches.name AS branch_name,
          inventory_stock_history.action,
          inventory_stock_history.quantity,
          COALESCE(
            NULLIF(CONCAT_WS(' ', users.first_name, users.last_name), ''),
            users.username,
            users.email
          ) AS created_by_name,
          inventory_stock_history.created_at
        FROM inventory_stock_history
        LEFT JOIN branches ON branches.id = inventory_stock_history.branch_id
        LEFT JOIN users ON users.id = inventory_stock_history.created_by
        WHERE inventory_stock_history.inventory_item_id = $1
          AND ($2::int[] IS NULL OR inventory_stock_history.branch_id = ANY($2::int[]))
        ORDER BY inventory_stock_history.created_at DESC, inventory_stock_history.id DESC
        LIMIT $3 OFFSET $4
      `,
      [itemId, req.access.allowedBranchIds, limit, (stockPage - 1) * limit],
    );
    const stockCountResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM inventory_stock_history
        WHERE inventory_item_id = $1 AND ($2::int[] IS NULL OR branch_id = ANY($2::int[]))
      `,
      [itemId, req.access.allowedBranchIds],
    );

    const priceHistoryResult = await pool.query(
      `
        SELECT
          inventory_price_history.id,
          inventory_price_history.inventory_item_id,
          inventory_price_history.old_price,
          inventory_price_history.new_price,
          COALESCE(
            NULLIF(CONCAT_WS(' ', users.first_name, users.last_name), ''),
            users.username,
            users.email
          ) AS created_by_name,
          inventory_price_history.created_at
        FROM inventory_price_history
        LEFT JOIN users ON users.id = inventory_price_history.created_by
        WHERE inventory_price_history.inventory_item_id = $1
        ORDER BY inventory_price_history.created_at DESC, inventory_price_history.id DESC
        LIMIT $2 OFFSET $3
      `,
      [itemId, limit, (pricePage - 1) * limit],
    );
    const priceCountResult = await pool.query(
      "SELECT COUNT(*)::int AS total FROM inventory_price_history WHERE inventory_item_id = $1",
      [itemId],
    );

    return res.json({
      item: {
        id: itemResult.rows[0].id,
        name: itemResult.rows[0].name,
      },
      history: historyResult.rows.map(serializeInventoryHistoryEntry),
      priceHistory: priceHistoryResult.rows.map(serializeInventoryPriceHistoryEntry),
      limit,
      stockPage,
      pricePage,
      stockTotal: stockCountResult.rows[0].total,
      priceTotal: priceCountResult.rows[0].total,
    });
  } catch (error) {
    console.error(error);
    return res.status(error.status || 500).json({ message: error.message || "Unable to load inventory history." });
  }
});

app.post("/api/pos/login", async (req, res) => {
  const { businessCode, code } = req.body;

  if (!businessCode || !code) {
    return res.status(400).json({ message: "Business Code and Code are required." });
  }

  try {
    const result = await pool.query(
      `
        SELECT
          businesses.id AS business_id,
          businesses.name AS business_name,
          businesses.business_id_code,
          businesses.logo_image,
          branches.id AS branch_id,
          branches.name AS branch_name,
          branches.pos_code,
          branches.is_disabled
        FROM businesses
        JOIN branches ON branches.business_id = businesses.id
        WHERE UPPER(businesses.business_id_code) = UPPER($1)
          AND branches.pos_code = $2
          AND businesses.status = 'A'
        LIMIT 1
      `,
      [String(businessCode).trim(), String(code).trim()],
    );
    const session = result.rows[0];

    if (!session) {
      return res.status(401).json({ message: "Invalid Business Code or Code." });
    }

    if (session.is_disabled) {
      return res.status(403).json({
        message: "This branch has been disabled. Ask the owner to enable it to use the POS.",
      });
    }

    const token = jwt.sign(
      {
        pos: true,
        businessId: session.business_id,
        businessCode: session.business_id_code,
        branchId: session.branch_id,
        branchName: session.branch_name,
      },
      jwtSecret,
      { expiresIn: "12h" },
    );

    return res.json({ token, session: serializePosSession(session) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Unable to sign in to POS." });
  }
});

app.get("/api/pos/session", authenticatePos, async (req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT
          businesses.id AS business_id,
          businesses.name AS business_name,
          businesses.business_id_code,
          businesses.logo_image,
          branches.id AS branch_id,
          branches.name AS branch_name,
          branches.pos_code
        FROM branches
        JOIN businesses ON businesses.id = branches.business_id
        WHERE branches.id = $1 AND businesses.id = $2
      `,
      [req.pos.branchId, req.pos.businessId],
    );

    if (!result.rows[0]) {
      return res.status(404).json({ message: "Branch not found." });
    }

    return res.json({ session: serializePosSession(result.rows[0]) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Unable to load POS session." });
  }
});

app.get("/api/pos/items", authenticatePos, async (req, res) => {
  const searchTerm = String(req.query.search || "").trim();
  const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 8, 1), 30);
  const offset = (page - 1) * limit;
  const params = [req.pos.businessId, req.pos.branchId];
  let searchFilter = "";

  if (searchTerm) {
    const normalizedItemCodeSearch = searchTerm.replace(/^ITEM[-_\s]*/i, "");
    params.push(`%${searchTerm}%`, `%${normalizedItemCodeSearch}%`);
    searchFilter = `
      AND (
        inventory_items.name ILIKE $3
        OR CAST(inventory_items.id AS TEXT) ILIKE $4
      )
    `;
  }

  try {
    const itemsResult = await pool.query(
      `
        SELECT
          inventory_items.id,
          inventory_items.name,
          inventory_items.image_data,
          inventory_items.price,
          inventory_item_branches.assigned_stocks AS stock_left
        FROM inventory_items
        JOIN inventory_item_branches ON inventory_item_branches.inventory_item_id = inventory_items.id
        JOIN branches ON branches.id = inventory_item_branches.branch_id
        WHERE inventory_items.business_id = $1
          AND inventory_item_branches.branch_id = $2
          AND branches.business_id = $1
          AND branches.is_disabled = FALSE
          ${searchFilter}
        ORDER BY inventory_items.sort_order ASC, inventory_items.id ASC
        LIMIT ${limit}
        OFFSET ${offset}
      `,
      params,
    );
    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM inventory_items
        JOIN inventory_item_branches ON inventory_item_branches.inventory_item_id = inventory_items.id
        JOIN branches ON branches.id = inventory_item_branches.branch_id
        WHERE inventory_items.business_id = $1
          AND inventory_item_branches.branch_id = $2
          AND branches.business_id = $1
          AND branches.is_disabled = FALSE
          ${searchFilter}
      `,
      params,
    );
    const total = countResult.rows[0]?.total || 0;

    return res.json({
      items: itemsResult.rows.map(serializePosItem),
      page,
      limit,
      total,
      totalPages: Math.max(Math.ceil(total / limit), 1),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Unable to load POS inventory." });
  }
});

const supportedTimeZones = new Set(Intl.supportedValuesOf("timeZone"));

// Turns ?from=YYYY-MM-DD&to=YYYY-MM-DD&tz=Area/City into conditions on `column`, so a "day"
// starts at midnight in the viewer's timezone instead of the database's (UTC).
function buildDateRangeFilters(column, query, params) {
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  const fromDate = String(query.from || "").trim();
  const toDate = String(query.to || "").trim();
  const requestedTimeZone = String(query.tz || "").trim();
  const timeZone = supportedTimeZones.has(requestedTimeZone) ? requestedTimeZone : "UTC";
  const filters = [];

  if (!isoDate.test(fromDate) && !isoDate.test(toDate)) {
    return filters;
  }

  params.push(timeZone);
  const timeZoneIndex = params.length;

  if (isoDate.test(fromDate)) {
    params.push(fromDate);
    filters.push(`${column} >= ($${params.length}::date::timestamp AT TIME ZONE $${timeZoneIndex})`);
  }

  if (isoDate.test(toDate)) {
    params.push(toDate);
    filters.push(`${column} < (($${params.length}::date + 1)::timestamp AT TIME ZONE $${timeZoneIndex})`);
  }

  return filters;
}

async function queryBranchSales(businessId, branchId, query) {
  const receiptSearch = String(query.receipt || "").trim();
  const itemSearch = String(query.item || "").trim();
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 8, 1), 30);
  const offset = (page - 1) * limit;
  const params = [businessId, branchId];
  const filters = [];

  if (receiptSearch) {
    params.push(`%${receiptSearch}%`);
    filters.push(`pos_sales.receipt_code ILIKE $${params.length}`);
  }

  filters.push(...buildDateRangeFilters("pos_sales.created_at", query, params));

  if (itemSearch) {
    const normalizedItemCodeSearch = itemSearch.replace(/^ITEM[-_\s]*/i, "");
    params.push(`%${itemSearch}%`, `%${normalizedItemCodeSearch}%`);
    const itemNameIndex = params.length - 1;
    const itemCodeIndex = params.length;
    filters.push(`
      EXISTS (
        SELECT 1
        FROM pos_sale_items filter_items
        WHERE filter_items.sale_id = pos_sales.id
          AND (
            filter_items.item_name ILIKE $${itemNameIndex}
            OR filter_items.item_code ILIKE $${itemNameIndex}
            OR CAST(filter_items.inventory_item_id AS TEXT) ILIKE $${itemCodeIndex}
          )
      )
    `);
  }

  const filterSql = filters.length ? `AND ${filters.join(" AND ")}` : "";
  const salesResult = await pool.query(
    `
      SELECT
        pos_sales.id,
        pos_sales.receipt_code,
        pos_sales.total_items,
        pos_sales.total_amount,
        pos_sales.created_at,
        sale_items.item_sold,
        COALESCE(returned_items.returned_items, 0)::int AS returned_items,
        COALESCE(returned_items.returned_amount, 0) AS returned_amount
      FROM pos_sales
      JOIN LATERAL (
        SELECT STRING_AGG(item_name || ' x' || quantity, ', ' ORDER BY id) AS item_sold
        FROM pos_sale_items
        WHERE sale_id = pos_sales.id
      ) sale_items ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(SUM(pos_refund_items.quantity), 0)::int AS returned_items,
          COALESCE(SUM(pos_refund_items.total_price), 0) AS returned_amount
        FROM pos_sale_items
        JOIN pos_refund_items ON pos_refund_items.sale_item_id = pos_sale_items.id
        WHERE pos_sale_items.sale_id = pos_sales.id
      ) returned_items ON TRUE
      WHERE pos_sales.business_id = $1
        AND pos_sales.branch_id = $2
        ${filterSql}
      ORDER BY pos_sales.created_at DESC, pos_sales.id DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `,
    params,
  );
  const countResult = await pool.query(
    `
      SELECT COUNT(*)::int AS total
      FROM pos_sales
      WHERE pos_sales.business_id = $1
        AND pos_sales.branch_id = $2
        ${filterSql}
    `,
    params,
  );
  const total = countResult.rows[0]?.total || 0;

  return {
    sales: salesResult.rows.map(serializePosSale),
    page,
    limit,
    total,
    totalPages: Math.max(Math.ceil(total / limit), 1),
  };
}

async function querySalesTotalsByBranch(businessId, query, branchId = null) {
  const params = [businessId];
  const branchFilter = branchId ? `AND pos_sales.branch_id = $${params.push(branchId)}` : "";
  const saleFilters = buildDateRangeFilters("pos_sales.created_at", query, params)
    .map((filter) => `AND ${filter}`)
    .join(" ");
  // Refunds are attributed to the sale they came from, so a sale's refund is never counted
  // as part of the sales total and the total always equals the sum of the sales rows.
  const result = await pool.query(
    `
      WITH sales AS (
        SELECT pos_sales.branch_id, COUNT(*)::int AS transactions,
          COALESCE(SUM(pos_sales.total_items), 0)::int AS items_sold,
          COALESCE(SUM(pos_sales.total_amount), 0) AS gross_sales
        FROM pos_sales
        WHERE pos_sales.business_id = $1 ${branchFilter} ${saleFilters}
        GROUP BY pos_sales.branch_id
      ),
      refunds AS (
        SELECT pos_sales.branch_id, COALESCE(SUM(pos_refund_items.quantity), 0)::int AS items_refunded,
          COALESCE(SUM(pos_refund_items.total_price), 0) AS refunds
        FROM pos_sales
        JOIN pos_sale_items ON pos_sale_items.sale_id = pos_sales.id
        JOIN pos_refund_items ON pos_refund_items.sale_item_id = pos_sale_items.id
        WHERE pos_sales.business_id = $1 ${branchFilter} ${saleFilters}
        GROUP BY pos_sales.branch_id
      )
      SELECT sales.branch_id,
        sales.transactions,
        sales.items_sold,
        COALESCE(refunds.items_refunded, 0) AS items_refunded,
        sales.gross_sales,
        COALESCE(refunds.refunds, 0) AS refunds
      FROM sales
      LEFT JOIN refunds ON refunds.branch_id = sales.branch_id
    `,
    params,
  );

  return new Map(
    result.rows.map((row) => [
      Number(row.branch_id),
      {
        transactions: Number(row.transactions),
        itemsSold: Number(row.items_sold),
        itemsRefunded: Number(row.items_refunded),
        grossSales: Number(row.gross_sales),
        refunds: Number(row.refunds),
      },
    ]),
  );
}

function finishSalesTotals(totals = {}) {
  const grossSales = totals.grossSales || 0;
  const refunds = totals.refunds || 0;

  const itemsSold = totals.itemsSold || 0;
  const itemsRefunded = totals.itemsRefunded || 0;

  return {
    transactions: totals.transactions || 0,
    itemsSold,
    itemsRefunded,
    netItemsSold: itemsSold - itemsRefunded,
    grossSales,
    refunds,
    netSales: grossSales - refunds,
  };
}

async function queryBranchSalesSummary(businessId, branchId, query) {
  const totals = await querySalesTotalsByBranch(businessId, query, branchId);

  return finishSalesTotals(totals.get(branchId));
}

async function queryBranchReceipt(saleId, businessId, branchId) {
  const saleResult = await pool.query(
    `
      SELECT
        pos_sales.id,
        pos_sales.receipt_code,
        businesses.name AS business_name,
        branches.name AS branch_name,
        pos_sales.total_items,
        pos_sales.total_amount,
        pos_sales.created_at,
        COALESCE(returned_items.returned_items, 0)::int AS returned_items
      FROM pos_sales
      JOIN businesses ON businesses.id = pos_sales.business_id
      JOIN branches ON branches.id = pos_sales.branch_id
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(pos_refund_items.quantity), 0)::int AS returned_items
        FROM pos_sale_items
        JOIN pos_refund_items ON pos_refund_items.sale_item_id = pos_sale_items.id
        WHERE pos_sale_items.sale_id = pos_sales.id
      ) returned_items ON TRUE
      WHERE pos_sales.id = $1
        AND pos_sales.business_id = $2
        AND pos_sales.branch_id = $3
    `,
    [saleId, businessId, branchId],
  );

  if (!saleResult.rows[0]) {
    return null;
  }

  const itemsResult = await pool.query(
    `
      SELECT
        pos_sale_items.item_code,
        pos_sale_items.item_name,
        pos_sale_items.quantity,
        pos_sale_items.unit_price,
        pos_sale_items.total_price,
        COALESCE(SUM(pos_refund_items.quantity), 0)::int AS refunded_quantity
      FROM pos_sale_items
      LEFT JOIN pos_refund_items ON pos_refund_items.sale_item_id = pos_sale_items.id
      WHERE pos_sale_items.sale_id = $1
      GROUP BY pos_sale_items.id
      ORDER BY pos_sale_items.id ASC
    `,
    [saleId],
  );

  return serializePosReceipt(saleResult.rows[0], itemsResult.rows);
}

async function getOwnedBranchId(userId, branchIdParam) {
  const branchId = Number(branchIdParam);

  if (!Number.isInteger(branchId) || branchId <= 0) {
    const error = new Error("Select a valid branch.");
    error.status = 400;
    throw error;
  }

  const businessId = await getCurrentBusinessId(userId);
  const result = await pool.query("SELECT id FROM branches WHERE id = $1 AND business_id = $2", [
    branchId,
    businessId,
  ]);

  if (!result.rows[0]) {
    const error = new Error("Branch not found.");
    error.status = 404;
    throw error;
  }

  return { businessId, branchId };
}

app.get("/api/pos/sales", authenticatePos, async (req, res) => {
  try {
    return res.json(await queryBranchSales(req.pos.businessId, req.pos.branchId, req.query));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Unable to load POS sales." });
  }
});

app.get("/api/pos/sales/:id", authenticatePos, async (req, res) => {
  const saleId = Number(req.params.id);

  if (!Number.isInteger(saleId) || saleId <= 0) {
    return res.status(400).json({ message: "Select a valid sale." });
  }

  try {
    const receipt = await queryBranchReceipt(saleId, req.pos.businessId, req.pos.branchId);

    if (!receipt) {
      return res.status(404).json({ message: "Sale not found." });
    }

    return res.json({ receipt });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Unable to load receipt." });
  }
});

app.get("/api/dashboard", authenticate, requireAccess(section("dashboard")), async (req, res) => {
  try {
    const businessId = await getCurrentBusinessId(req.user.sub);
    const businessResult = await pool.query(
      "SELECT name, business_id_code, logo_image, low_stock_threshold FROM businesses WHERE id = $1",
      [businessId],
    );
    const lowStockThreshold = Number(businessResult.rows[0]?.low_stock_threshold ?? 3);
    const [branchesResult, salesByBranch, overallLowStock, branchLowStock] = await Promise.all([
      pool.query(
        `
          SELECT id, name, is_disabled
          FROM branches
          WHERE business_id = $1
          ORDER BY sort_order ASC, id ASC
        `,
        [businessId],
      ),
      querySalesTotalsByBranch(businessId, req.query),
      pool.query(
        `
          SELECT id, name, stocks
          FROM inventory_items
          WHERE business_id = $1 AND stocks <= $2
          ORDER BY stocks ASC, sort_order ASC, id ASC
        `,
        [businessId, lowStockThreshold],
      ),
      pool.query(
        `
          SELECT inventory_item_branches.branch_id, inventory_items.id, inventory_items.name,
            inventory_item_branches.assigned_stocks AS stocks
          FROM inventory_item_branches
          JOIN inventory_items ON inventory_items.id = inventory_item_branches.inventory_item_id
          WHERE inventory_items.business_id = $1 AND inventory_item_branches.assigned_stocks <= $2
          ORDER BY inventory_item_branches.assigned_stocks ASC, inventory_items.sort_order ASC, inventory_items.id ASC
        `,
        [businessId, lowStockThreshold],
      ),
    ]);
    const business = businessResult.rows[0];
    const serializeLowStock = (row) => ({ id: row.id, name: row.name, stocks: Number(row.stocks) });
    const overallTotals = {};
    const visibleBranches = branchesResult.rows.filter((branch) => canAccessBranch(req.access, branch.id));
    const visibleBranchLowStock = branchLowStock.rows.filter((row) => canAccessBranch(req.access, row.branch_id));
    // Someone limited to some branches only sees low stock in those branches.
    const overallLowStockItems = hasAllBranches(req.access)
      ? overallLowStock.rows
      : [...new Map(visibleBranchLowStock.map((row) => [row.id, row])).values()];

    for (const [branchId, totals] of salesByBranch.entries()) {
      if (!canAccessBranch(req.access, branchId)) {
        continue;
      }

      for (const [key, value] of Object.entries(totals)) {
        overallTotals[key] = (overallTotals[key] || 0) + value;
      }
    }

    return res.json({
      business: {
        name: business?.name || "",
        code: business?.business_id_code || "",
        logo: business?.logo_image || null,
      },
      lowStockThreshold,
      overall: {
        ...finishSalesTotals(overallTotals),
        lowStockItems: overallLowStockItems.map(serializeLowStock),
      },
      branches: visibleBranches.map((branch) => ({
        id: branch.id,
        name: branch.name,
        isDisabled: branch.is_disabled,
        ...finishSalesTotals(salesByBranch.get(branch.id)),
        lowStockItems: visibleBranchLowStock
          .filter((row) => row.branch_id === branch.id)
          .map(serializeLowStock),
      })),
    });
  } catch (error) {
    console.error(error);
    return res.status(error.status || 500).json({ message: error.status ? error.message : "Unable to load dashboard." });
  }
});

app.get("/api/branches/:branchId/sales", authenticate, requireAccess((a, req) => a.permissions.sections.branches && canAccessBranch(a, req.params.branchId)), async (req, res) => {
  try {
    const { businessId, branchId } = await getOwnedBranchId(req.user.sub, req.params.branchId);
    const [sales, summary] = await Promise.all([
      queryBranchSales(businessId, branchId, req.query),
      queryBranchSalesSummary(businessId, branchId, req.query),
    ]);

    return res.json({ ...sales, summary });
  } catch (error) {
    console.error(error);
    return res.status(error.status || 500).json({ message: error.status ? error.message : "Unable to load sales." });
  }
});

app.get("/api/branches/:branchId/sales/:saleId", authenticate, requireAccess((a, req) => a.permissions.sections.branches && canAccessBranch(a, req.params.branchId)), async (req, res) => {
  const saleId = Number(req.params.saleId);

  if (!Number.isInteger(saleId) || saleId <= 0) {
    return res.status(400).json({ message: "Select a valid sale." });
  }

  try {
    const { businessId, branchId } = await getOwnedBranchId(req.user.sub, req.params.branchId);
    const receipt = await queryBranchReceipt(saleId, businessId, branchId);

    if (!receipt) {
      return res.status(404).json({ message: "Sale not found." });
    }

    return res.json({ receipt });
  } catch (error) {
    console.error(error);
    return res.status(error.status || 500).json({ message: error.status ? error.message : "Unable to load receipt." });
  }
});

app.get("/api/pos/refunds", authenticatePos, async (req, res) => {
  const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 8, 1), 30);
  const offset = (page - 1) * limit;

  try {
    const refundsResult = await pool.query(
      `
        SELECT
          pos_refunds.id,
          pos_refunds.refund_code,
          pos_sales.receipt_code,
          pos_refunds.total_items,
          pos_refunds.total_amount,
          pos_refunds.created_at,
          STRING_AGG(pos_refund_items.item_name || ' x' || pos_refund_items.quantity, ', ' ORDER BY pos_refund_items.id) AS item_returned
        FROM pos_refunds
        LEFT JOIN pos_sales ON pos_sales.id = pos_refunds.sale_id
        JOIN pos_refund_items ON pos_refund_items.refund_id = pos_refunds.id
        WHERE pos_refunds.business_id = $1
          AND pos_refunds.branch_id = $2
        GROUP BY pos_refunds.id, pos_sales.receipt_code
        ORDER BY pos_refunds.created_at DESC, pos_refunds.id DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `,
      [req.pos.businessId, req.pos.branchId],
    );
    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM pos_refunds
        WHERE business_id = $1 AND branch_id = $2
      `,
      [req.pos.businessId, req.pos.branchId],
    );
    const total = countResult.rows[0]?.total || 0;

    return res.json({
      refunds: refundsResult.rows.map(serializePosRefund),
      page,
      limit,
      total,
      totalPages: Math.max(Math.ceil(total / limit), 1),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Unable to load refund history." });
  }
});

app.get("/api/pos/refund/search", authenticatePos, async (req, res) => {
  const type = req.query.type === "item" ? "item" : "receipt";
  const searchTerm = String(req.query.q || "").trim();

  if (!searchTerm) {
    return res.json({ results: [] });
  }

  try {
    if (type === "receipt") {
      const result = await pool.query(
        `
          SELECT
            pos_sales.id,
            pos_sales.receipt_code,
            pos_sales.total_items,
            pos_sales.total_amount,
            pos_sales.created_at,
            STRING_AGG(pos_sale_items.item_name || ' x' || pos_sale_items.quantity, ', ' ORDER BY pos_sale_items.id) AS item_sold
          FROM pos_sales
          JOIN pos_sale_items ON pos_sale_items.sale_id = pos_sales.id
          WHERE pos_sales.business_id = $1
            AND pos_sales.branch_id = $2
            AND pos_sales.receipt_code ILIKE $3
          GROUP BY pos_sales.id
          ORDER BY pos_sales.created_at DESC, pos_sales.id DESC
          LIMIT 10
        `,
        [req.pos.businessId, req.pos.branchId, `%${searchTerm}%`],
      );

      return res.json({ results: result.rows.map(serializeRefundSearchReceipt) });
    }

    const normalizedItemCodeSearch = searchTerm.replace(/^ITEM[-_\s]*/i, "");
    const result = await pool.query(
      `
        SELECT
          pos_sale_items.id AS sale_item_id,
          pos_sale_items.sale_id,
          pos_sale_items.inventory_item_id,
          pos_sale_items.item_code,
          pos_sale_items.item_name,
          pos_sale_items.quantity AS sold_quantity,
          COALESCE(SUM(pos_refund_items.quantity), 0) AS refunded_quantity,
          pos_sale_items.quantity - COALESCE(SUM(pos_refund_items.quantity), 0) AS refundable_quantity,
          pos_sale_items.unit_price,
          pos_sales.receipt_code,
          pos_sales.created_at
        FROM pos_sale_items
        JOIN pos_sales ON pos_sales.id = pos_sale_items.sale_id
        LEFT JOIN pos_refund_items ON pos_refund_items.sale_item_id = pos_sale_items.id
        WHERE pos_sales.business_id = $1
          AND pos_sales.branch_id = $2
          AND (
            pos_sale_items.item_name ILIKE $3
            OR pos_sale_items.item_code ILIKE $3
            OR CAST(pos_sale_items.inventory_item_id AS TEXT) ILIKE $4
          )
        GROUP BY pos_sale_items.id, pos_sales.id
        HAVING pos_sale_items.quantity - COALESCE(SUM(pos_refund_items.quantity), 0) > 0
        ORDER BY pos_sales.created_at DESC, pos_sale_items.id DESC
        LIMIT 20
      `,
      [req.pos.businessId, req.pos.branchId, `%${searchTerm}%`, `%${normalizedItemCodeSearch}%`],
    );

    return res.json({ results: result.rows.map(serializeRefundSearchItem) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Unable to search refunds." });
  }
});

app.get("/api/pos/refund/receipts/:id/items", authenticatePos, async (req, res) => {
  const saleId = Number(req.params.id);

  if (!Number.isInteger(saleId) || saleId <= 0) {
    return res.status(400).json({ message: "Select a valid receipt." });
  }

  try {
    const result = await pool.query(
      `
        SELECT
          pos_sale_items.id AS sale_item_id,
          pos_sale_items.sale_id,
          pos_sale_items.inventory_item_id,
          pos_sale_items.item_code,
          pos_sale_items.item_name,
          pos_sale_items.quantity AS sold_quantity,
          COALESCE(SUM(pos_refund_items.quantity), 0) AS refunded_quantity,
          pos_sale_items.quantity - COALESCE(SUM(pos_refund_items.quantity), 0) AS refundable_quantity,
          pos_sale_items.unit_price,
          pos_sales.receipt_code,
          pos_sales.created_at
        FROM pos_sale_items
        JOIN pos_sales ON pos_sales.id = pos_sale_items.sale_id
        LEFT JOIN pos_refund_items ON pos_refund_items.sale_item_id = pos_sale_items.id
        WHERE pos_sales.id = $1
          AND pos_sales.business_id = $2
          AND pos_sales.branch_id = $3
        GROUP BY pos_sale_items.id, pos_sales.id
        HAVING pos_sale_items.quantity - COALESCE(SUM(pos_refund_items.quantity), 0) > 0
        ORDER BY pos_sale_items.id ASC
      `,
      [saleId, req.pos.businessId, req.pos.branchId],
    );

    return res.json({ items: result.rows.map(serializeRefundSearchItem) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Unable to load receipt items." });
  }
});

app.post("/api/pos/refunds", authenticatePos, async (req, res) => {
  const requestedItems = Array.isArray(req.body.items) ? req.body.items : [];
  const quantityBySaleItemId = new Map();

  requestedItems.forEach((item) => {
    const saleItemId = Number(item.saleItemId);
    const quantity = Number(item.quantity);

    if (Number.isInteger(saleItemId) && saleItemId > 0 && Number.isInteger(quantity) && quantity > 0) {
      quantityBySaleItemId.set(saleItemId, (quantityBySaleItemId.get(saleItemId) || 0) + quantity);
    }
  });

  const saleItemIds = [...quantityBySaleItemId.keys()];

  if (saleItemIds.length === 0) {
    return res.status(400).json({ message: "Select at least one item to refund." });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const saleItemsResult = await client.query(
      `
        SELECT
          pos_sale_items.id AS sale_item_id,
          pos_sale_items.sale_id,
          pos_sale_items.inventory_item_id,
          pos_sale_items.item_code,
          pos_sale_items.item_name,
          pos_sale_items.quantity AS sold_quantity,
          pos_sale_items.unit_price,
          pos_sales.receipt_code
        FROM pos_sale_items
        JOIN pos_sales ON pos_sales.id = pos_sale_items.sale_id
        WHERE pos_sale_items.id = ANY($3::int[])
          AND pos_sales.business_id = $1
          AND pos_sales.branch_id = $2
        FOR UPDATE OF pos_sale_items
      `,
      [req.pos.businessId, req.pos.branchId, saleItemIds],
    );

    if (saleItemsResult.rows.length !== saleItemIds.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "One or more refund items are not valid." });
    }

    const refundedResult = await client.query(
      `
        SELECT sale_item_id, COALESCE(SUM(quantity), 0)::int AS refunded_quantity
        FROM pos_refund_items
        WHERE sale_item_id = ANY($1::int[])
        GROUP BY sale_item_id
      `,
      [saleItemIds],
    );
    const refundedBySaleItemId = new Map(
      refundedResult.rows.map((row) => [Number(row.sale_item_id), Number(row.refunded_quantity || 0)]),
    );
    const refundItems = saleItemsResult.rows.map((row) => {
      const saleItemId = Number(row.sale_item_id);
      const quantity = quantityBySaleItemId.get(saleItemId);
      const alreadyRefunded = refundedBySaleItemId.get(saleItemId) || 0;
      const refundableQuantity = Number(row.sold_quantity) - alreadyRefunded;

      if (quantity > refundableQuantity) {
        throw new Error(`${row.item_name} only has ${refundableQuantity} item(s) available to refund.`);
      }

      return {
        saleItemId,
        saleId: Number(row.sale_id),
        inventoryItemId: row.inventory_item_id ? Number(row.inventory_item_id) : null,
        itemCode: row.item_code,
        itemName: row.item_name,
        quantity,
        unitPrice: Number(row.unit_price || 0),
        totalPrice: Number((quantity * Number(row.unit_price || 0)).toFixed(2)),
      };
    });
    const saleIds = [...new Set(refundItems.map((item) => item.saleId))];
    const refundCode = `RFND-${Date.now()}-${Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, "0")}`;
    const totalItems = refundItems.reduce((total, item) => total + item.quantity, 0);
    const totalAmount = Number(refundItems.reduce((total, item) => total + item.totalPrice, 0).toFixed(2));
    const refundResult = await client.query(
      `
        INSERT INTO pos_refunds (business_id, branch_id, sale_id, refund_code, total_items, total_amount)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, refund_code, total_items, total_amount, created_at
      `,
      [req.pos.businessId, req.pos.branchId, saleIds.length === 1 ? saleIds[0] : null, refundCode, totalItems, totalAmount],
    );
    const refund = refundResult.rows[0];

    for (const item of refundItems) {
      if (item.inventoryItemId) {
        await client.query(
          `
            UPDATE inventory_items
            SET stocks = stocks + $3,
                updated_at = NOW()
            WHERE id = $1 AND business_id = $2
          `,
          [item.inventoryItemId, req.pos.businessId, item.quantity],
        );
        await client.query(
          `
            INSERT INTO inventory_item_branches (inventory_item_id, branch_id, assigned_stocks)
            VALUES ($1, $2, $3)
            ON CONFLICT (inventory_item_id, branch_id)
            DO UPDATE SET assigned_stocks = inventory_item_branches.assigned_stocks + EXCLUDED.assigned_stocks
          `,
          [item.inventoryItemId, req.pos.branchId, item.quantity],
        );
        await client.query(
          `
            INSERT INTO inventory_stock_history (inventory_item_id, branch_id, action, quantity)
            VALUES ($1, $2, 'refund', $3)
          `,
          [item.inventoryItemId, req.pos.branchId, item.quantity],
        );
      }

      await client.query(
        `
          INSERT INTO pos_refund_items (
            refund_id,
            sale_item_id,
            inventory_item_id,
            item_code,
            item_name,
            quantity,
            unit_price,
            total_price
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          refund.id,
          item.saleItemId,
          item.inventoryItemId,
          item.itemCode,
          item.itemName,
          item.quantity,
          item.unitPrice,
          item.totalPrice,
        ],
      );
    }

    await client.query("COMMIT");

    return res.status(201).json({
      refund: {
        id: refund.id,
        refundCode: refund.refund_code,
        totalItems: Number(refund.total_items || 0),
        totalAmount: Number(refund.total_amount || 0),
        createdAt: refund.created_at,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    return res.status(400).json({ message: error.message || "Unable to refund items." });
  } finally {
    client.release();
  }
});

app.post("/api/pos/checkout", authenticatePos, async (req, res) => {
  const requestedItems = Array.isArray(req.body.items) ? req.body.items : [];
  const quantityByItemId = new Map();

  requestedItems.forEach((item) => {
    const itemId = Number(item.itemId);
    const quantity = Number(item.quantity);

    if (Number.isInteger(itemId) && itemId > 0 && Number.isInteger(quantity) && quantity > 0) {
      quantityByItemId.set(itemId, (quantityByItemId.get(itemId) || 0) + quantity);
    }
  });

  const itemIds = [...quantityByItemId.keys()];

  if (itemIds.length === 0) {
    return res.status(400).json({ message: "Select at least one item to check out." });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const sessionResult = await client.query(
      `
        SELECT
          businesses.name AS business_name,
          branches.name AS branch_name
        FROM businesses
        JOIN branches ON branches.business_id = businesses.id
        WHERE businesses.id = $1
          AND branches.id = $2
          AND businesses.status = 'A'
          AND branches.is_disabled = FALSE
      `,
      [req.pos.businessId, req.pos.branchId],
    );

    if (sessionResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(401).json({ message: "POS session is no longer valid." });
    }

    const stockResult = await client.query(
      `
        SELECT
          inventory_items.id,
          inventory_items.name,
          inventory_items.price,
          inventory_item_branches.assigned_stocks
        FROM inventory_items
        JOIN inventory_item_branches ON inventory_item_branches.inventory_item_id = inventory_items.id
        WHERE inventory_items.business_id = $1
          AND inventory_item_branches.branch_id = $2
          AND inventory_items.id = ANY($3::int[])
        FOR UPDATE
      `,
      [req.pos.businessId, req.pos.branchId, itemIds],
    );

    if (stockResult.rows.length !== itemIds.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "One or more items are no longer available." });
    }

    const saleItems = stockResult.rows.map((item) => {
      const quantity = quantityByItemId.get(Number(item.id));
      const stockLeft = Number(item.assigned_stocks);
      const unitPrice = Number(item.price || 0);

      if (quantity > stockLeft) {
        throw new Error(`${item.name} only has ${stockLeft} stock left.`);
      }

      return {
        itemId: Number(item.id),
        itemCode: `ITEM-${String(item.id).padStart(4, "0")}`,
        itemName: item.name,
        quantity,
        unitPrice,
        totalPrice: Number((quantity * unitPrice).toFixed(2)),
      };
    });
    const totalItems = saleItems.reduce((total, item) => total + item.quantity, 0);
    const totalAmount = Number(saleItems.reduce((total, item) => total + item.totalPrice, 0).toFixed(2));
    const receiptCode = `RCPT-${Date.now()}-${Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, "0")}`;
    const saleResult = await client.query(
      `
        INSERT INTO pos_sales (business_id, branch_id, receipt_code, total_items, total_amount)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, receipt_code, total_items, total_amount, created_at
      `,
      [req.pos.businessId, req.pos.branchId, receiptCode, totalItems, totalAmount],
    );
    const sale = saleResult.rows[0];

    for (const item of saleItems) {
      await client.query(
        `
          UPDATE inventory_items
          SET stocks = stocks - $3,
              updated_at = NOW()
          WHERE id = $1 AND business_id = $2
        `,
        [item.itemId, req.pos.businessId, item.quantity],
      );
      await client.query(
        `
          UPDATE inventory_item_branches
          SET assigned_stocks = assigned_stocks - $3
          WHERE inventory_item_id = $1 AND branch_id = $2
        `,
        [item.itemId, req.pos.branchId, item.quantity],
      );
      await client.query(
        `
          INSERT INTO inventory_stock_history (inventory_item_id, branch_id, action, quantity)
          VALUES ($1, $2, 'sale', $3)
        `,
        [item.itemId, req.pos.branchId, item.quantity],
      );
      await client.query(
        `
          INSERT INTO pos_sale_items (
            sale_id,
            inventory_item_id,
            item_code,
            item_name,
            quantity,
            unit_price,
            total_price
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [sale.id, item.itemId, item.itemCode, item.itemName, item.quantity, item.unitPrice, item.totalPrice],
      );
    }

    await client.query("COMMIT");

    return res.status(201).json({
      receipt: serializePosReceipt(
        {
          ...sale,
          business_name: sessionResult.rows[0].business_name,
          branch_name: sessionResult.rows[0].branch_name,
        },
        saleItems.map((item) => ({
          item_code: item.itemCode,
          item_name: item.itemName,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          total_price: item.totalPrice,
        })),
      ),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    return res.status(400).json({ message: error.message || "Unable to check out." });
  } finally {
    client.release();
  }
});

async function start() {
  try {
    await ensureSchema();
    app.listen(port, () => {
      console.log(`CowFlo API listening on port ${port}`);
    });
  } catch (error) {
    console.error("Failed to start server", error);
    process.exit(1);
  }
}

start();
