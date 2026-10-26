import React, { Component, useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";

function resolveApiBaseUrl() {
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }

  const hostname = typeof window === "undefined" ? "127.0.0.1" : window.location.hostname;

  return `http://${hostname}:4000/api`;
}

const apiBaseUrl = resolveApiBaseUrl();
const storageKey = "cowflow-pos-session";
const pageSize = 8;

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      message: error?.message || "Something went wrong.",
    };
  }

  resetPos() {
    window.localStorage.removeItem(storageKey);
    window.location.reload();
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="login-page">
          <section className="login-panel">
            <div className="brand-mark">CF</div>
            <h1>CowFlo POS</h1>
            <p>POS needed to reset the saved session.</p>
            <span className="error-text">{this.state.message}</span>
            <button type="button" onClick={() => this.resetPos()}>
              Reset POS
            </button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// SKU numbers start at 1 and show at least three digits: 001, 002, ... 999, 1000.
function formatSkuLabel(item) {
  return item.skuName ? `${item.skuName} - ${String(item.skuNumber ?? "").padStart(3, "0")}` : "";
}

// Items are tagged by SKU; the item number only shows for items that have no SKU yet.
function getItemTag(item) {
  return formatSkuLabel(item) || item.itemCode || "";
}

function ItemTags({ item }) {
  return (
    <>
      {item.skuName ? <small className="sku-tag-mobile">{formatSkuLabel(item)}</small> : null}
      {item.categoryName ? <small className="category-tag">{item.categoryName}</small> : null}
    </>
  );
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatReceiptDateTime(value) {
  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sanitizeFilePart(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    || "receipt";
}

function formatReceiptFileDateTime(value) {
  const date = new Date(value);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const year = safeDate.getFullYear();
  const month = String(safeDate.getMonth() + 1).padStart(2, "0");
  const day = String(safeDate.getDate()).padStart(2, "0");
  const hour = String(safeDate.getHours()).padStart(2, "0");
  const minute = String(safeDate.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day}_${hour}-${minute}`;
}

function formatDateInput(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getReceiptFileName(receipt) {
  const branchName = sanitizeFilePart(receipt.branchName);
  const checkoutId = sanitizeFilePart(receipt.id || receipt.receiptCode);
  const receiptDateTime = formatReceiptFileDateTime(receipt.createdAt);

  return `${branchName}_${checkoutId}_${receiptDateTime}.png`;
}

function buildCheckoutReceiptHtml({ businessName, branchName, cart, totals }) {
  const rows = cart
    .map(
      (item) => `
        <div class="checkout-preview-line">
          <span>
            <strong>${escapeHtml(item.name)}</strong>
            <small>${formatMoney(item.price)} x ${item.quantity}</small>
          </span>
          <strong>${formatMoney(item.price * item.quantity)}</strong>
        </div>
      `,
    )
    .join("");

  return `
    <div class="checkout-preview">
      <h3>${escapeHtml(businessName)}</h3>
      <p>${escapeHtml(branchName)}</p>
      <small>Checkout preview</small>
      <small>${formatReceiptDateTime(new Date())}</small>
      <div class="checkout-preview-lines">${rows}</div>
      <div class="checkout-preview-total">
        <span>Total items</span>
        <strong>${totals.totalItems}</strong>
      </div>
      <div class="checkout-preview-total amount">
        <span>Total paid amount</span>
        <strong>${formatMoney(totals.totalAmount)}</strong>
      </div>
    </div>
  `;
}

function buildRefundItemsHtml(items, { includeReturnAll = false } = {}) {
  if (!items.length) {
    return `<div class="refund-empty">No refundable items found.</div>`;
  }

  const returnAllControl = includeReturnAll
    ? `
        <div class="refund-return-all-row">
          <span>Return all items in this receipt</span>
          <button type="button" id="refund-return-all">Return all</button>
        </div>
      `
    : "";

  return (
    returnAllControl +
    items
    .map(
      (item) => `
        <div class="refund-item-row">
          <span>
            <strong>${escapeHtml(item.itemName)}</strong>
            <small>${escapeHtml(item.itemCode)} - ${escapeHtml(item.receiptCode || "")}</small>
            <small>Available to return: ${item.refundableQuantity}</small>
          </span>
          <input
            class="refund-qty"
            type="number"
            min="0"
            max="${item.refundableQuantity}"
            step="1"
            value="0"
            data-sale-item-id="${item.saleItemId}"
            data-max="${item.refundableQuantity}"
          >
        </div>
      `,
    )
      .join("")
  );
}

function readSavedSession() {
  try {
    const saved = window.localStorage.getItem(storageKey);
    const parsed = saved ? JSON.parse(saved) : null;

    if (
      !parsed?.token ||
      !parsed?.session?.business?.name ||
      !parsed?.session?.branch?.name
    ) {
      window.localStorage.removeItem(storageKey);
      return null;
    }

    return parsed;
  } catch {
    window.localStorage.removeItem(storageKey);
    return null;
  }
}

function getRefundedQuantity(item) {
  const quantity = Number(item.quantity || 0);
  const refundedQuantity = Number(item.refundedQuantity || 0);

  return Math.min(Math.max(refundedQuantity, 0), quantity);
}

function getReceiptLineNetTotal(item) {
  const refundedQuantity = getRefundedQuantity(item);
  const returnedAmount = refundedQuantity * Number(item.unitPrice || 0);

  return Math.max(Number(item.totalPrice || 0) - returnedAmount, 0);
}

function getReceiptNetTotal(receipt) {
  return Number(
    receipt.items
      .reduce((total, item) => total + getReceiptLineNetTotal(item), 0)
      .toFixed(2),
  );
}

function saveReceiptImage(receipt) {
  const canvas = document.createElement("canvas");
  const width = 760;
  const hasReturnedItems = receipt.items.some((item) => getRefundedQuantity(item) > 0);
  const headerExtra = receipt.isFullyReturned ? 28 : 0;
  const rowHeight = hasReturnedItems ? 46 : 34;
  const height = 324 + headerExtra + receipt.items.length * rowHeight;
  const ctx = canvas.getContext("2d");

  canvas.width = width;
  canvas.height = height;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#050505";
  ctx.font = "700 30px Arial";
  ctx.textAlign = "center";
  ctx.fillText(receipt.businessName, width / 2, 52);
  ctx.font = "600 18px Arial";
  ctx.fillText(receipt.branchName, width / 2, 82);
  ctx.font = "14px Arial";
  ctx.fillStyle = "#666666";
  ctx.fillText(receipt.receiptCode, width / 2, 108);
  if (receipt.isFullyReturned) {
    ctx.fillStyle = "#15803d";
    ctx.font = "700 13px Arial";
    ctx.fillText("Returned all", width / 2, 130);
  }
  ctx.font = "14px Arial";
  ctx.fillStyle = "#666666";
  ctx.fillText(formatReceiptDateTime(receipt.createdAt), width / 2, 132 + headerExtra);
  ctx.textAlign = "left";
  ctx.fillStyle = "#050505";
  ctx.font = "700 14px Arial";
  ctx.fillText("Item", 52, 174 + headerExtra);
  ctx.fillText("Price", 390, 174 + headerExtra);
  ctx.fillText("Qty", 500, 174 + headerExtra);
  ctx.fillText("Total", 590, 174 + headerExtra);
  ctx.strokeStyle = "#dddddd";
  ctx.beginPath();
  ctx.moveTo(52, 188 + headerExtra);
  ctx.lineTo(708, 188 + headerExtra);
  ctx.stroke();

  ctx.font = "14px Arial";
  receipt.items.forEach((item, index) => {
    const y = 220 + headerExtra + index * rowHeight;
    const refundedQuantity = getRefundedQuantity(item);

    ctx.fillStyle = "#050505";
    ctx.fillText(item.itemName.slice(0, 34), 52, y);
    ctx.fillText(formatMoney(item.unitPrice), 390, y);
    ctx.fillText(`x ${item.quantity}`, 500, y);
    ctx.fillText(formatMoney(getReceiptLineNetTotal(item)), 590, y);

    if (refundedQuantity > 0) {
      ctx.fillStyle = "#dc2626";
      ctx.font = "700 12px Arial";
      ctx.fillText(`Returned -${refundedQuantity}`, 52, y + 18);
      ctx.font = "14px Arial";
    }
  });

  const totalY = 244 + headerExtra + receipt.items.length * rowHeight;
  ctx.beginPath();
  ctx.moveTo(52, totalY);
  ctx.lineTo(708, totalY);
  ctx.stroke();
  ctx.font = "700 22px Arial";
  ctx.fillText("Total paid amount", 52, totalY + 44);
  ctx.textAlign = "right";
  ctx.fillText(formatMoney(getReceiptNetTotal(receipt)), 708, totalY + 44);

  const link = document.createElement("a");
  link.download = getReceiptFileName(receipt);
  link.href = canvas.toDataURL("image/png");
  link.click();
}

const navIcons = {
  Dashboard: {
    viewBox: "0 0 512 512",
    path: "M64 64c0-17.7-14.3-32-32-32S0 46.3 0 64v336c0 44.2 35.8 80 80 80h400c17.7 0 32-14.3 32-32s-14.3-32-32-32H80c-8.8 0-16-7.2-16-16V64zm406.6 86.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L320 210.7l-57.4-57.4c-12.5-12.5-32.8-12.5-45.3 0l-112 112c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0l89.4-89.3 57.4 57.4c12.5 12.5 32.8 12.5 45.3 0l128-128z",
  },
  Sales: {
    viewBox: "0 0 384 512",
    path: "M14 2.2C22.5-1.7 32.5-.3 39.6 5.8L80 40.4 120.4 5.8c9-7.7 22.3-7.7 31.2 0L192 40.4 232.4 5.8c9-7.7 22.3-7.7 31.2 0L304 40.4 344.4 5.8c7.1-6.1 17.1-7.5 25.6-3.6S384 14.6 384 24v464c0 9.4-5.5 17.9-14 21.8s-18.5 2.5-25.6-3.6L304 471.6l-40.4 34.6c-9 7.7-22.3 7.7-31.2 0L192 471.6l-40.4 34.6c-9 7.7-22.3 7.7-31.2 0L80 471.6 39.6 506.2c-7.1 6.1-17.1 7.5-25.6 3.6S0 497.4 0 488V24C0 14.6 5.5 6.1 14 2.2zM96 144c-8.8 0-16 7.2-16 16s7.2 16 16 16h192c8.8 0 16-7.2 16-16s-7.2-16-16-16H96zM80 352c0 8.8 7.2 16 16 16h192c8.8 0 16-7.2 16-16s-7.2-16-16-16H96c-8.8 0-16 7.2-16 16zm16-112c-8.8 0-16 7.2-16 16s7.2 16 16 16h192c8.8 0 16-7.2 16-16s-7.2-16-16-16H96z",
  },
  Inventory: {
    viewBox: "0 0 576 512",
    path: "M248 0h-40c-26.5 0-48 21.5-48 48v112c0 35.3 28.7 64 64 64h128c35.3 0 64-28.7 64-64V48c0-26.5-21.5-48-48-48h-40v80c0 8.8-7.2 16-16 16h-48c-8.8 0-16-7.2-16-16V0zM64 256c-35.3 0-64 28.7-64 64v128c0 35.3 28.7 64 64 64h160c35.3 0 64-28.7 64-64V320c0-35.3-28.7-64-64-64h-40v80c0 8.8-7.2 16-16 16h-48c-8.8 0-16-7.2-16-16v-80H64zm288 256h160c35.3 0 64-28.7 64-64V320c0-35.3-28.7-64-64-64h-40v80c0 8.8-7.2 16-16 16h-48c-8.8 0-16-7.2-16-16v-80h-40c-15 0-28.8 5.1-39.7 13.8 4.9 10.4 7.7 22 7.7 34.2v160c0 12.2-2.7 23.8-7.7 34.2C323.2 506.9 337 512 352 512z",
  },
};

function NavIcon({ name }) {
  const icon = navIcons[name];

  return (
    <svg className="nav-icon" viewBox={icon.viewBox} aria-hidden="true">
      <path fill="currentColor" d={icon.path} />
    </svg>
  );
}

function getBrandInitials(name) {
  return (
    String(name || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("") || "C"
  );
}

function LoginPage({ onLogin, initialMessage = "" }) {
  const [businessCode, setBusinessCode] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState(initialMessage);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");
    setLoading(true);

    try {
      const response = await fetch(`${apiBaseUrl}/pos/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessCode, code }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message || "Unable to sign in.");
      }

      window.localStorage.setItem(storageKey, JSON.stringify(payload));
      onLogin(payload);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <form className="login-panel" onSubmit={handleSubmit}>
        <div className="brand-mark">CF</div>
        <h1>CowFlo POS</h1>
        <p>Sign in with the business code and branch POS code.</p>
        <label>
          Business Code
          <input
            value={businessCode}
            onChange={(event) => setBusinessCode(event.target.value)}
            placeholder="WPR_001"
          />
        </label>
        <label>
          Code
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="Branch POS code"
          />
        </label>
        {message ? <span className="error-text">{message}</span> : null}
        <button type="submit" disabled={loading}>
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  );
}

function ReceiptModal({ receipt, onClose, showSuccess = false }) {
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSaved(false);
  }, [receipt?.id, receipt?.receiptCode]);

  if (!receipt) {
    return null;
  }

  function handleSaveReceipt() {
    saveReceiptImage(receipt);
    setSaved(true);
  }

  return (
    <div className="modal-backdrop">
      <section className="receipt-modal">
        {showSuccess ? (
          <div className="receipt-success-mark" aria-hidden="true">
            <span></span>
          </div>
        ) : null}
        <div className="receipt-paper" id="receipt-paper">
          <h2>{receipt.businessName}</h2>
          <p>{receipt.branchName}</p>
          <small>{receipt.receiptCode}</small>
          {receipt.isFullyReturned ? (
            <span className="returned-tag receipt-returned-tag">Returned all</span>
          ) : null}
          <small>{formatReceiptDateTime(receipt.createdAt)}</small>
          <div className="receipt-lines">
            {receipt.items.map((item) => {
              const refundedQuantity = getRefundedQuantity(item);

              return (
                <div key={`${item.itemCode}-${item.itemName}`} className="receipt-line">
                  <span>
                    {item.itemName}
                    <small>
                      {formatMoney(item.unitPrice)} x {item.quantity}
                    </small>
                    {refundedQuantity > 0 ? (
                      <small className="item-returned-note">Returned -{refundedQuantity}</small>
                    ) : null}
                  </span>
                  <strong>{formatMoney(getReceiptLineNetTotal(item))}</strong>
                </div>
              );
            })}
          </div>
          <div className="receipt-total">
            <span>Total paid amount</span>
            <strong>{formatMoney(getReceiptNetTotal(receipt))}</strong>
          </div>
        </div>
        {saved ? (
          <span className="receipt-save-status">
            <span className="save-check-icon" aria-hidden="true"></span>
            Saved successfully
          </span>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="ghost-btn" onClick={onClose}>
            Close
          </button>
          <button type="button" onClick={handleSaveReceipt}>
            Save
          </button>
        </div>
      </section>
    </div>
  );
}

function ItemDetailsModal({ item, selectedQuantity, onAdd, onClose, viewOnly = false }) {
  if (!item) {
    return null;
  }

  const remaining = item.stockLeft - selectedQuantity;

  return (
    <div className="modal-backdrop">
      <section className="item-detail-modal">
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">
          x
        </button>
        <div className="detail-image-wrap">
          {item.imageData ? (
            <img src={item.imageData} alt={item.name} />
          ) : (
            <span className="detail-image-placeholder">IMG</span>
          )}
        </div>
        <div className="detail-name-line">
          <strong>{getItemTag(item)}</strong>
          <span>{item.name}</span>
          {item.categoryName ? <small>{item.categoryName}</small> : null}
        </div>
        <div className="detail-stock-line">
          <span>Available stock: {item.stockLeft}</span>
          {!viewOnly ? <strong>Selected stock: -{selectedQuantity}</strong> : null}
        </div>
        <div className="detail-price-line">
          <span>Price</span>
          <strong>{formatMoney(item.price)}</strong>
        </div>
        {!viewOnly ? (
          <button
            type="button"
            className="detail-add-btn"
            disabled={remaining <= 0}
            onClick={() => onAdd(item)}
          >
            {remaining <= 0 ? "No stock left" : "Add item"}
          </button>
        ) : null}
      </section>
    </div>
  );
}

function DashboardPage({ auth, onLogout, onSessionUpdate }) {
  const businessName = auth.session?.business?.name || "CowFlo POS";
  const branchName = auth.session?.branch?.name || "Branch";
  const businessLogo = auth.session?.business?.logo || null;
  const [activeTab, setActiveTab] = useState("Dashboard");
  const [items, setItems] = useState([]);
  const [cart, setCart] = useState([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [message, setMessage] = useState("");
  const [loadingItems, setLoadingItems] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [receiptShowsSuccess, setReceiptShowsSuccess] = useState(false);
  const [viewingItem, setViewingItem] = useState(null);
  const [sales, setSales] = useState([]);
  const [salesSection, setSalesSection] = useState("receipts");
  const [salesPage, setSalesPage] = useState(1);
  const [salesTotalPages, setSalesTotalPages] = useState(1);
  const [salesLoading, setSalesLoading] = useState(false);
  const [salesMessage, setSalesMessage] = useState("");
  const [salesFilters, setSalesFilters] = useState({
    receipt: "",
    from: "",
    to: "",
    item: "",
  });
  const [refunds, setRefunds] = useState([]);
  const [refundPage, setRefundPage] = useState(1);
  const [refundTotalPages, setRefundTotalPages] = useState(1);
  const [refundsLoading, setRefundsLoading] = useState(false);

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${auth.token}`,
  };
  const totals = useMemo(
    () =>
      cart.reduce(
        (summary, item) => ({
          totalItems: summary.totalItems + item.quantity,
          totalAmount: summary.totalAmount + item.quantity * item.price,
        }),
        { totalItems: 0, totalAmount: 0 },
      ),
    [cart],
  );

  useEffect(() => {
    requestPos("/pos/session")
      .then((payload) => onSessionUpdate?.(payload.session))
      .catch(() => {});

    // Re-check now and then so an idle POS still signs out soon after its branch is disabled.
    const timer = window.setInterval(() => {
      requestPos("/pos/session").catch(() => {});
    }, 30000);

    return () => window.clearInterval(timer);
  }, []);

  async function requestPos(path, options = {}) {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...options,
      headers: {
        ...headers,
        ...(options.headers || {}),
      },
    });
    const payload = await response.json();

    if (payload.code === "POS_SESSION_ENDED") {
      onLogout(payload.message);
    }

    if (!response.ok) {
      throw new Error(payload.message || "POS request failed.");
    }

    return payload;
  }

  async function loadItems(nextPage = page) {
    setLoadingItems(true);
    setMessage("");

    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        limit: String(pageSize),
      });

      if (search.trim()) {
        params.set("search", search.trim());
      }

      const payload = await requestPos(`/pos/items?${params.toString()}`);

      setItems(payload.items);
      setPage(payload.page);
      setTotalPages(payload.totalPages);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoadingItems(false);
    }
  }

  useEffect(() => {
    loadItems(1);
  }, [search]);

  async function loadSales(nextPage = salesPage) {
    setSalesLoading(true);
    setSalesMessage("");

    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        limit: String(pageSize),
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      });

      Object.entries(salesFilters).forEach(([key, value]) => {
        if (value.trim()) {
          params.set(key, value.trim());
        }
      });

      const payload = await requestPos(`/pos/sales?${params.toString()}`);

      setSales(payload.sales);
      setSalesPage(payload.page);
      setSalesTotalPages(payload.totalPages);
    } catch (error) {
      setSalesMessage(error.message);
    } finally {
      setSalesLoading(false);
    }
  }

  async function loadRefunds(nextPage = refundPage) {
    setRefundsLoading(true);

    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        limit: String(pageSize),
      });
      const payload = await requestPos(`/pos/refunds?${params.toString()}`);

      setRefunds(payload.refunds);
      setRefundPage(payload.page);
      setRefundTotalPages(payload.totalPages);
    } catch (error) {
      setSalesMessage(error.message);
    } finally {
      setRefundsLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab === "Sales" && salesSection === "receipts") {
      loadSales(1);
    }
  }, [activeTab, salesSection, salesFilters.receipt, salesFilters.from, salesFilters.to, salesFilters.item]);

  useEffect(() => {
    if (activeTab === "Sales" && salesSection === "refunds") {
      loadRefunds(1);
    }
  }, [activeTab, salesSection]);

  function selectedQuantity(itemId) {
    return cart.find((item) => item.id === itemId)?.quantity || 0;
  }

  function addItem(item) {
    const currentQuantity = selectedQuantity(item.id);

    if (item.stockLeft - currentQuantity <= 0) {
      return;
    }

    setCart((current) => {
      const existing = current.find((entry) => entry.id === item.id);

      if (existing) {
        return current.map((entry) =>
          entry.id === item.id ? { ...entry, quantity: entry.quantity + 1 } : entry,
        );
      }

      return [...current, { ...item, quantity: 1 }];
    });
  }

  async function removeFromCart(item) {
    const result = await Swal.fire({
      html: `
        <div class="pos-confirm-icon">
          <svg viewBox="0 0 448 512" aria-hidden="true"><path fill="currentColor" d="M135.2 17.7 128 32H32C14.3 32 0 46.3 0 64s14.3 32 32 32h384c17.7 0 32-14.3 32-32s-14.3-32-32-32h-96l-7.2-14.3C307.4 6.8 296.3 0 284.2 0H163.8c-12.1 0-23.2 6.8-28.6 17.7zM416 128H32l21.2 339c1.6 25.3 22.6 45 47.9 45h245.8c25.3 0 46.3-19.7 47.9-45L416 128z"/></svg>
        </div>
        <h2 class="pos-confirm-title">Remove this item?</h2>
        <p class="pos-confirm-text">It will be taken out of the current sale.</p>
        <div class="pos-confirm-card">
          <div>
            <small>${escapeHtml(getItemTag(item))}</small>
            <strong>${escapeHtml(item.name)}</strong>
            <span>${formatMoney(item.price)} x ${item.quantity}</span>
          </div>
          <b>${formatMoney(item.price * item.quantity)}</b>
        </div>
      `,
      showCancelButton: true,
      reverseButtons: true,
      focusCancel: true,
      buttonsStyling: false,
      confirmButtonText: "Remove item",
      cancelButtonText: "Keep item",
      customClass: {
        popup: "pos-confirm",
        htmlContainer: "pos-confirm-body",
        actions: "pos-confirm-actions",
        confirmButton: "pos-confirm-danger",
        cancelButton: "pos-confirm-cancel",
      },
    });

    if (result.isConfirmed) {
      setCart((current) => current.filter((entry) => entry.id !== item.id));
    }
  }

  function changeQuantity(itemId, nextQuantity) {
    setCart((current) =>
      current
        .map((item) => {
          if (item.id !== itemId) {
            return item;
          }

          return {
            ...item,
            quantity: Math.min(Math.max(Number(nextQuantity) || 1, 1), item.stockLeft),
          };
        })
        .filter((item) => item.quantity > 0),
    );
  }

  async function cancelSale() {
    if (cart.length === 0) {
      return;
    }

    const result = await Swal.fire({
      title: "Cancel sale?",
      text: "This will remove all selected items from the current sale.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, cancel sale",
      cancelButtonText: "Keep sale",
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#111111",
    });

    if (result.isConfirmed) {
      setCart([]);
    }
  }

  async function checkout() {
    if (cart.length === 0) {
      return;
    }

    const result = await Swal.fire({
      title: "Check out sale?",
      html: buildCheckoutReceiptHtml({ businessName, branchName, cart, totals }),
      showCancelButton: true,
      confirmButtonText: "Confirm checkout",
      cancelButtonText: "Review items",
      confirmButtonColor: "#63e050",
      cancelButtonColor: "#111111",
      width: 480,
    });

    if (!result.isConfirmed) {
      return;
    }

    setCheckingOut(true);
    setMessage("");

    try {
      const payload = await requestPos("/pos/checkout", {
        method: "POST",
        body: JSON.stringify({
          items: cart.map((item) => ({
            itemId: item.id,
            quantity: item.quantity,
          })),
        }),
      });

      setReceiptShowsSuccess(true);
      setReceipt(payload.receipt);
      setCart([]);
      await loadItems(page);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setCheckingOut(false);
    }
  }

  async function viewSaleReceipt(saleId) {
    try {
      const payload = await requestPos(`/pos/sales/${saleId}`);
      setReceiptShowsSuccess(false);
      setReceipt(payload.receipt);
    } catch (error) {
      setSalesMessage(error.message);
    }
  }

  async function openRefundPopup() {
    let mode = "receipt";

    const result = await Swal.fire({
      title: "Refund",
      html: `
        <div class="refund-popup">
          <div class="refund-tabs">
            <button type="button" class="refund-tab active" data-mode="receipt">Receipt</button>
            <button type="button" class="refund-tab" data-mode="item">Item</button>
          </div>
          <div class="refund-search-row">
            <input id="refund-search" class="swal2-input" placeholder="Search receipt code" autocomplete="off">
            <button type="button" id="refund-search-btn">Search</button>
          </div>
          <div id="refund-results" class="refund-results"></div>
          <div id="refund-items" class="refund-items"></div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: "Return stocks",
      cancelButtonText: "Close",
      confirmButtonColor: "#63e050",
      cancelButtonColor: "#111111",
      width: 620,
      didOpen: () => {
        const popup = Swal.getPopup();
        const searchInput = popup.querySelector("#refund-search");
        const searchButton = popup.querySelector("#refund-search-btn");
        const resultsContainer = popup.querySelector("#refund-results");
        const itemsContainer = popup.querySelector("#refund-items");
        const tabs = [...popup.querySelectorAll(".refund-tab")];

        const renderRefundItems = (items, options = {}) => {
          itemsContainer.innerHTML = buildRefundItemsHtml(items, options);

          const returnAllButton = itemsContainer.querySelector("#refund-return-all");
          if (returnAllButton) {
            returnAllButton.addEventListener("click", () => {
              itemsContainer.querySelectorAll(".refund-qty").forEach((input) => {
                input.value = input.dataset.max || "0";
              });
            });
          }
        };

        const renderReceiptResults = (receipts) => {
          if (!receipts.length) {
            resultsContainer.innerHTML = `<div class="refund-empty">No matching receipts found.</div>`;
            renderRefundItems([]);
            return;
          }

          resultsContainer.innerHTML = receipts
            .map(
              (sale) => `
                <button type="button" class="refund-result" data-sale-id="${sale.id}">
                  <span>
                    <strong>${escapeHtml(sale.receiptCode)}</strong>
                    <small>${formatReceiptDateTime(sale.createdAt)}</small>
                  </span>
                  <small>${escapeHtml(sale.itemSold)}</small>
                </button>
              `,
            )
            .join("");

          [...resultsContainer.querySelectorAll(".refund-result")].forEach((button) => {
            button.addEventListener("click", async () => {
              resultsContainer
                .querySelectorAll(".refund-result")
                .forEach((item) => item.classList.remove("selected"));
              button.classList.add("selected");
              itemsContainer.innerHTML = `<div class="refund-empty">Loading receipt items...</div>`;

              try {
                const payload = await requestPos(`/pos/refund/receipts/${button.dataset.saleId}/items`);
                renderRefundItems(payload.items, { includeReturnAll: true });
              } catch (error) {
                itemsContainer.innerHTML = `<div class="refund-empty">${escapeHtml(error.message)}</div>`;
              }
            });
          });
        };

        const searchRefunds = async () => {
          const query = searchInput.value.trim();
          resultsContainer.innerHTML = "";
          renderRefundItems([]);

          if (!query) {
            resultsContainer.innerHTML = `<div class="refund-empty">Enter a search first.</div>`;
            return;
          }

          resultsContainer.innerHTML = `<div class="refund-empty">Searching...</div>`;

          try {
            const params = new URLSearchParams({ type: mode, q: query });
            const payload = await requestPos(`/pos/refund/search?${params.toString()}`);

            if (mode === "receipt") {
              renderReceiptResults(payload.results);
            } else {
              resultsContainer.innerHTML = "";
              renderRefundItems(payload.results);
            }
          } catch (error) {
            resultsContainer.innerHTML = `<div class="refund-empty">${escapeHtml(error.message)}</div>`;
          }
        };

        tabs.forEach((tab) => {
          tab.addEventListener("click", () => {
            mode = tab.dataset.mode;
            tabs.forEach((item) => item.classList.toggle("active", item === tab));
            searchInput.value = "";
            searchInput.placeholder = mode === "receipt" ? "Search receipt code" : "Search item name or code";
            resultsContainer.innerHTML = "";
            renderRefundItems([]);
          });
        });

        searchButton.addEventListener("click", searchRefunds);
        searchInput.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            searchRefunds();
          }
        });
      },
      preConfirm: () => {
        const popup = Swal.getPopup();
        const refundItems = [...popup.querySelectorAll(".refund-qty")]
          .map((input) => ({
            saleItemId: Number(input.dataset.saleItemId),
            quantity: Number(input.value),
            max: Number(input.dataset.max),
          }))
          .filter((item) => item.quantity > 0);

        if (refundItems.length === 0) {
          Swal.showValidationMessage("Enter at least one return quantity.");
          return false;
        }

        if (
          refundItems.some(
            (item) =>
              !Number.isInteger(item.saleItemId) ||
              !Number.isInteger(item.quantity) ||
              item.quantity <= 0 ||
              item.quantity > item.max,
          )
        ) {
          Swal.showValidationMessage("Return quantities must not exceed available stock to return.");
          return false;
        }

        return { items: refundItems.map(({ saleItemId, quantity }) => ({ saleItemId, quantity })) };
      },
    });

    if (!result.isConfirmed) {
      return;
    }

    const confirmResult = await Swal.fire({
      title: "Return stocks?",
      text: "Returned quantities will be added back to this branch inventory.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, return stocks",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#63e050",
      cancelButtonColor: "#111111",
    });

    if (!confirmResult.isConfirmed) {
      return;
    }

    try {
      const payload = await requestPos("/pos/refunds", {
        method: "POST",
        body: JSON.stringify(result.value),
      });

      await Swal.fire("Stocks returned", payload.refund.refundCode, "success");
      await loadRefunds(1);
      await loadSales(salesPage);
      await loadItems(page);
    } catch (error) {
      await Swal.fire("Unable to refund", error.message, "error");
    }
  }

  async function confirmLogout() {
    const result = await Swal.fire({
      title: "Log out?",
      text: "Your current POS session will be closed.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, log out",
      cancelButtonText: "Stay logged in",
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#111111",
    });

    if (result.isConfirmed) {
      onLogout();
    }
  }

  return (
    <main className="pos-shell">
      <header className="pos-topbar">
        <div className="pos-brand">
          <span className="pos-brand-logo">
            {businessLogo ? <img src={businessLogo} alt="" /> : getBrandInitials(businessName)}
          </span>
          <div className="pos-brand-text">
            <strong>{businessName}</strong>
            <span>{branchName}</span>
          </div>
        </div>
        <nav>
          {["Dashboard", "Sales", "Inventory"].map((tab) => (
            <button
              key={tab}
              type="button"
              className={activeTab === tab ? "active" : ""}
              onClick={() => setActiveTab(tab)}
              aria-label={tab}
              title={tab}
            >
              <NavIcon name={tab} />
              <span className="nav-full">{tab}</span>
            </button>
          ))}
        </nav>
        <button type="button" className="logout-btn" onClick={confirmLogout}>
          Logout
        </button>
      </header>

      {activeTab === "Dashboard" ? (
        <section className="dashboard-grid">
          <aside className="cart-panel">
            <div className="panel-title">
              <h1>Sold items</h1>
              <span>{totals.totalItems} items</span>
            </div>
            <div className="cart-list">
              {cart.length === 0 ? (
                <div className="empty-state">Select an item to begin the sale.</div>
              ) : null}
              {cart.map((item) => (
                <article key={item.id} className="cart-item">
                  <div>
                    <strong>{getItemTag(item)}</strong>
                    <h2>{item.name}</h2>
                    <p>{formatMoney(item.price)} per pcs</p>
                  </div>
                  <div className="quantity-control">
                    <button
                      type="button"
                      onClick={() =>
                        item.quantity <= 1 ? removeFromCart(item) : changeQuantity(item.id, item.quantity - 1)
                      }
                      aria-label={item.quantity <= 1 ? `Remove ${item.name}` : "Decrease quantity"}
                    >
                      -
                    </button>
                    <input
                      value={item.quantity}
                      onChange={(event) => changeQuantity(item.id, event.target.value)}
                    />
                    <button type="button" onClick={() => changeQuantity(item.id, item.quantity + 1)}>
                      +
                    </button>
                  </div>
                  <strong className="line-total">{formatMoney(item.quantity * item.price)}</strong>
                </article>
              ))}
            </div>
            <footer className="cart-footer">
              <div>
                <span>Total items</span>
                <strong>{totals.totalItems}</strong>
              </div>
              <div>
                <span>Amount</span>
                <strong>{formatMoney(totals.totalAmount)}</strong>
              </div>
              <div className="cart-actions">
                <button type="button" className="ghost-btn" onClick={cancelSale}>
                  Cancel
                </button>
                <button type="button" onClick={checkout} disabled={cart.length === 0 || checkingOut}>
                  {checkingOut ? "Checking out..." : "Check out"}
                </button>
              </div>
            </footer>
          </aside>

          <section className="items-panel">
            <div className="panel-title">
              <h1>Items</h1>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search item code or name"
              />
            </div>
            {message ? <p className="error-text">{message}</p> : null}
            <div className="item-list">
              {loadingItems ? <div className="empty-state">Loading items...</div> : null}
              {!loadingItems &&
                items.map((item) => {
                  const remaining = item.stockLeft - selectedQuantity(item.id);
                  const disabled = remaining <= 0;

                  return (
                    <article
                      key={item.id}
                      className={`item-row ${disabled ? "disabled" : ""}`}
                    >
                      <button
                        type="button"
                        className="item-select-button"
                        onClick={() => addItem(item)}
                        disabled={disabled}
                      >
                        <span className="item-code" title={getItemTag(item)}>{getItemTag(item)}</span>
                        {item.imageData ? (
                          <img src={item.imageData} alt={item.name} />
                        ) : (
                          <span className="image-placeholder">IMG</span>
                        )}
                        <span className="item-summary">
                          <strong>{item.name}</strong>
                          <span className="item-meta">
                            <small>{remaining} stocks</small>
                            <small>{formatMoney(item.price)}</small>
                            <ItemTags item={item} />
                          </span>
                        </span>
                        <strong className="item-price">{formatMoney(item.price)}</strong>
                      </button>
                      <button
                        type="button"
                        className="view-item-button"
                        onClick={() => setViewingItem(item)}
                        aria-label={`View ${item.name}`}
                      >
                        i
                      </button>
                    </article>
                  );
                })}
              {!loadingItems && items.length === 0 ? (
                <div className="empty-state">No items found.</div>
              ) : null}
            </div>
            <div className="pagination">
              <button type="button" disabled={page <= 1} onClick={() => loadItems(page - 1)}>
                Previous
              </button>
              <span>
                Page {page} of {totalPages}
              </span>
              <button type="button" disabled={page >= totalPages} onClick={() => loadItems(page + 1)}>
                Next
              </button>
            </div>
          </section>
        </section>
      ) : null}

      {activeTab === "Sales" ? (
        <section className="simple-panel sales-panel">
          <div className="panel-title sales-title">
            <h1>Sales</h1>
          </div>
          {salesMessage ? <p className="error-text panel-message">{salesMessage}</p> : null}
          <div className="sales-subnav" role="tablist" aria-label="Sales views">
            <button
              type="button"
              className={salesSection === "receipts" ? "active" : ""}
              onClick={() => setSalesSection("receipts")}
            >
              Receipts
            </button>
            <button
              type="button"
              className={salesSection === "refunds" ? "active" : ""}
              onClick={() => setSalesSection("refunds")}
            >
              Refunds
            </button>
          </div>
          {salesSection === "receipts" ? (
            <>
              <div className="sales-filters">
                <div className="sales-search-pair">
                  <input
                    type="search"
                    value={salesFilters.receipt}
                    onChange={(event) =>
                      setSalesFilters((current) => ({ ...current, receipt: event.target.value }))
                    }
                    placeholder="Search receipt code"
                  />
                  <input
                    type="search"
                    value={salesFilters.item}
                    onChange={(event) =>
                      setSalesFilters((current) => ({ ...current, item: event.target.value }))
                    }
                    placeholder="Search item in receipt"
                  />
                </div>
                <div className="date-range-filter">
                  <input
                    type="date"
                    value={salesFilters.from}
                    onChange={(event) =>
                      setSalesFilters((current) => ({ ...current, from: event.target.value }))
                    }
                    aria-label="From date"
                  />
                  <span>to</span>
                  <input
                    type="date"
                    value={salesFilters.to}
                    onChange={(event) =>
                      setSalesFilters((current) => ({ ...current, to: event.target.value }))
                    }
                    aria-label="To date"
                  />
                </div>
              </div>
              <div className="sales-list">
                <div className="sales-header">
                  <span>Receipt number</span>
                  <span>Date and time</span>
                  <span>Item sold</span>
                  <span>View</span>
                </div>
                {salesLoading ? <div className="empty-state">Loading sales...</div> : null}
                {!salesLoading && sales.length === 0 ? (
                  <div className="empty-state">No sales found.</div>
                ) : null}
                {!salesLoading &&
                  sales.map((sale) => (
                    <article key={sale.id} className="sales-row">
                      <span className="receipt-number-cell">
                        <strong>{sale.receiptCode}</strong>
                        {sale.isFullyReturned ? <span className="returned-tag">Returned all</span> : null}
                      </span>
                      <span>{formatReceiptDateTime(sale.createdAt)}</span>
                      <span className="sales-items">{sale.itemSold}</span>
                      <button
                        type="button"
                        className="view-item-button"
                        onClick={() => viewSaleReceipt(sale.id)}
                        aria-label={`View receipt ${sale.receiptCode}`}
                      >
                        i
                      </button>
                    </article>
                  ))}
              </div>
              <div className="pagination">
                <button type="button" disabled={salesPage <= 1} onClick={() => loadSales(salesPage - 1)}>
                  Previous
                </button>
                <span>
                  Page {salesPage} of {salesTotalPages}
                </span>
                <button
                  type="button"
                  disabled={salesPage >= salesTotalPages}
                  onClick={() => loadSales(salesPage + 1)}
                >
                  Next
                </button>
              </div>
            </>
          ) : (
            <div className="refund-history">
              <div className="refund-history-title">
                <h2>Refund history</h2>
                <button type="button" onClick={openRefundPopup}>
                  Refund
                </button>
              </div>
              <div className="refund-history-list">
                {refundsLoading ? <div className="empty-state">Loading refund history...</div> : null}
                {!refundsLoading && refunds.length === 0 ? (
                  <div className="empty-state">No refunds yet.</div>
                ) : null}
                {!refundsLoading &&
                  refunds.map((refund) => (
                    <article key={refund.id} className="refund-history-row">
                      <span>
                        <strong>{refund.refundCode}</strong>
                        <small>{refund.receiptCode || "Mixed receipts"}</small>
                      </span>
                      <span>{formatReceiptDateTime(refund.createdAt)}</span>
                      <span className="sales-items">{refund.itemReturned}</span>
                      <strong>{refund.totalItems} returned</strong>
                    </article>
                  ))}
              </div>
              <div className="pagination">
                <button
                  type="button"
                  disabled={refundPage <= 1}
                  onClick={() => loadRefunds(refundPage - 1)}
                >
                  Previous
                </button>
                <span>
                  Page {refundPage} of {refundTotalPages}
                </span>
                <button
                  type="button"
                  disabled={refundPage >= refundTotalPages}
                  onClick={() => loadRefunds(refundPage + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </section>
      ) : null}

      {activeTab === "Inventory" ? (
        <section className="simple-panel inventory-panel">
          <div className="panel-title">
            <h1>Inventory</h1>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search item code or name"
            />
          </div>
          {message ? <p className="error-text panel-message">{message}</p> : null}
          <div className="item-list inventory-only">
            {loadingItems ? <div className="empty-state">Loading inventory...</div> : null}
            {!loadingItems &&
              items.map((item) => (
                <article key={item.id} className="item-row inventory-row">
                  <span className="item-code" title={getItemTag(item)}>{getItemTag(item)}</span>
                  {item.imageData ? (
                    <img src={item.imageData} alt={item.name} />
                  ) : (
                    <span className="image-placeholder">IMG</span>
                  )}
                  <span className="inventory-summary">
                    <strong>{item.name}</strong>
                    <small>{item.stockLeft} stocks left</small>
                    {item.skuName || item.categoryName ? (
                      <span className="item-meta">
                        <ItemTags item={item} />
                      </span>
                    ) : null}
                  </span>
                  <strong className="inventory-price">{formatMoney(item.price)}</strong>
                  <button
                    type="button"
                    className="view-item-button"
                    onClick={() => setViewingItem(item)}
                    aria-label={`View ${item.name}`}
                  >
                    i
                  </button>
                </article>
              ))}
            {!loadingItems && items.length === 0 ? (
              <div className="empty-state">No inventory items found.</div>
            ) : null}
          </div>
          <div className="pagination">
            <button type="button" disabled={page <= 1} onClick={() => loadItems(page - 1)}>
              Previous
            </button>
            <span>
              Page {page} of {totalPages}
            </span>
            <button type="button" disabled={page >= totalPages} onClick={() => loadItems(page + 1)}>
              Next
            </button>
          </div>
        </section>
      ) : null}

      <ReceiptModal
        receipt={receipt}
        showSuccess={receiptShowsSuccess}
        onClose={() => {
          setReceipt(null);
          setReceiptShowsSuccess(false);
        }}
      />
      <ItemDetailsModal
        item={viewingItem}
        selectedQuantity={viewingItem ? selectedQuantity(viewingItem.id) : 0}
        onAdd={addItem}
        onClose={() => setViewingItem(null)}
        viewOnly={activeTab === "Inventory"}
      />
    </main>
  );
}

function AppContent() {
  const [auth, setAuth] = useState(readSavedSession);
  const [logoutMessage, setLogoutMessage] = useState("");

  function handleLogout(reason) {
    window.localStorage.removeItem(storageKey);
    setLogoutMessage(typeof reason === "string" ? reason : "");
    setAuth(null);
  }

  if (!auth) {
    return <LoginPage key={logoutMessage} onLogin={setAuth} initialMessage={logoutMessage} />;
  }

  function handleSessionUpdate(session) {
    setAuth((current) => {
      const next = current ? { ...current, session } : current;

      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Saving is a convenience; the in-memory session still works.
      }

      return next;
    });
  }

  return <DashboardPage auth={auth} onLogout={handleLogout} onSessionUpdate={handleSessionUpdate} />;
}

export default function App() {
  return (
    <AppErrorBoundary>
      <AppContent />
    </AppErrorBoundary>
  );
}
