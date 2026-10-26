import React, { Component, useEffect, useId, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowDown,
  faArrowLeft,
  faArrowRight,
  faArrowUp,
  faBarcode,
  faBars,
  faBoxesStacked,
  faBuilding,
  faCamera,
  faChartLine,
  faChevronDown,
  faChevronLeft,
  faChevronRight,
  faCirclePlus,
  faCalendarDays,
  faCircleCheck,
  faCoins,
  faClockRotateLeft,
  faCopy,
  faEnvelope,
  faEye,
  faEyeSlash,
  faGear,
  faGripVertical,
  faImage,
  faKey,
  faLock,
  faMagnifyingGlass,
  faPen,
  faPlus,
  faReceipt,
  faRightFromBracket,
  faSeedling,
  faShieldHeart,
  faTags,
  faTrashCan,
  faTriangleExclamation,
  faUpload,
  faUser,
  faUserGroup,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import Cropper from "react-easy-crop";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import cowfloLogo from "./assets/cowflo-logo.png";

const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL ||
  `http://${typeof window === "undefined" ? "localhost" : window.location.hostname}:4000/api`;
const storageKey = "cowflo-auth";

function getTodayDateInputValue() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Phones and tablets open their own camera app through `capture`; desktop browsers ignore it,
// so there we show a live webcam preview instead.
function prefersNativeCamera() {
  return window.matchMedia("(pointer: coarse)").matches || !navigator.mediaDevices?.getUserMedia;
}

function captureFromWebcam() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");

    overlay.style.cssText =
      "position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.75);padding:16px;";
    overlay.innerHTML = `
      <div style="width:100%;max-width:520px;background:#fff;border-radius:24px;overflow:hidden;font-family:inherit;">
        <div style="position:relative;background:#000;aspect-ratio:4/3;">
          <video autoplay playsinline muted style="width:100%;height:100%;object-fit:cover;"></video>
          <p data-camera-message style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;margin:0;padding:24px;text-align:center;color:#fff;font-size:14px;">Starting camera...</p>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;padding:14px;">
          <button type="button" data-camera-cancel style="height:40px;padding:0 16px;border-radius:12px;border:0;background:transparent;font-weight:600;color:rgba(0,0,0,0.6);cursor:pointer;">Cancel</button>
          <button type="button" data-camera-shoot disabled style="height:40px;padding:0 18px;border-radius:12px;border:0;background:#000;color:#fff;font-weight:600;cursor:pointer;opacity:0.4;">Take photo</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const video = overlay.querySelector("video");
    const messageElement = overlay.querySelector("[data-camera-message]");
    const shootButton = overlay.querySelector("[data-camera-shoot]");
    let stream = null;

    const close = (file) => {
      stream?.getTracks().forEach((track) => track.stop());
      overlay.remove();
      resolve(file);
    };

    overlay.querySelector("[data-camera-cancel]").addEventListener("click", () => close(null));
    shootButton.addEventListener("click", () => {
      const canvas = document.createElement("canvas");

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0);
      canvas.toBlob(
        (blob) => close(blob ? new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" }) : null),
        "image/jpeg",
        0.9,
      );
    });

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((mediaStream) => {
        stream = mediaStream;
        video.srcObject = mediaStream;
        messageElement.style.display = "none";
        shootButton.disabled = false;
        shootButton.style.opacity = "1";
      })
      .catch(() => {
        messageElement.textContent =
          "Camera is not available. Allow camera access in your browser, or use Gallery instead.";
      });
  });
}

function readImageFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Unable to read image."));
    reader.readAsDataURL(file);
  });
}

// Phone photos are often 2-5 MB; inventory only needs a small picture, so scale it down to
// at most 800px and re-encode it (WebP where the browser supports it, otherwise JPEG).
async function shrinkImageFileToDataUrl(file, maxSize = 800) {
  const source = await readImageFileAsDataUrl(file);
  const image = await new Promise((resolve, reject) => {
    const element = new Image();

    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("That file is not a supported image."));
    element.src = source;
  });
  const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  // JPEG has no transparency, so transparent PNG areas would turn black without a background.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const webp = canvas.toDataURL("image/webp", 0.82);
  const dataUrl = webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.82);

  return { dataUrl, mime: dataUrl.slice(5, dataUrl.indexOf(";")) };
}

function getInventoryImageSrc(item) {
  return item?.imageUrl ? `${apiBaseUrl}${item.imageUrl}` : "";
}

async function cropImageToDataUrl(source, pixelCrop, outputWidth, outputHeight, mime) {
  const image = await new Promise((resolve, reject) => {
    const element = new Image();

    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("That file is not a supported image."));
    element.src = source;
  });
  const scale = Math.min(1, outputWidth / pixelCrop.width);
  const canvas = document.createElement("canvas");

  canvas.width = Math.max(1, Math.round(pixelCrop.width * scale));
  canvas.height = Math.max(1, Math.round((pixelCrop.width * scale * outputHeight) / outputWidth));
  canvas
    .getContext("2d")
    .drawImage(
      image,
      pixelCrop.x,
      pixelCrop.y,
      pixelCrop.width,
      pixelCrop.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );

  return canvas.toDataURL(mime === "image/png" ? "image/png" : "image/jpeg", 0.9);
}

function ImageCropModal({ title, source, aspect, onCancel, onConfirm }) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedPixels, setCroppedPixels] = useState(null);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[28px] bg-white shadow-panel sm:rounded-[28px]"
      >
        <div className="flex items-center justify-between border-b border-black/8 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-black">{title}</h3>
            <p className="text-xs text-black/50">Drag to move. Scroll, pinch, or use the slider to zoom.</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-black/60 transition hover:bg-black/5 hover:text-black"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <div className="relative h-[55vh] min-h-[260px] bg-black sm:h-[420px]">
          <Cropper
            image={source}
            crop={crop}
            zoom={zoom}
            minZoom={1}
            maxZoom={4}
            aspect={aspect}
            showGrid
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={(_, pixels) => setCroppedPixels(pixels)}
          />
        </div>

        <div className="flex items-center gap-3 px-5 py-4">
          <FontAwesomeIcon icon={faMagnifyingGlass} className="text-sm text-black/40" />
          <input
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            aria-label="Zoom"
            className="h-2 flex-1 cursor-pointer accent-black"
          />
          <span className="w-12 text-right text-xs font-semibold text-black/50">{Math.round(zoom * 100)}%</span>
        </div>

        <div className="flex justify-end gap-3 border-t border-black/8 bg-black/[0.02] px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 rounded-xl px-4 text-sm font-semibold text-black/60 transition hover:bg-black/5 hover:text-black"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!croppedPixels}
            onClick={() => onConfirm(croppedPixels)}
            className="inline-flex h-10 items-center justify-center rounded-xl bg-black px-5 text-sm font-semibold text-white transition hover:bg-black/85 disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

const desktopMediaQuery = "(min-width: 1024px)";

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window === "undefined" ? true : window.matchMedia(desktopMediaQuery).matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(desktopMediaQuery);
    const handleChange = (event) => setIsDesktop(event.matches);

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return isDesktop;
}

const emptyPasswordForm = { currentPassword: "", newPassword: "", confirmPassword: "" };

function getAccountFormValues(user) {
  return {
    firstName: user.firstName || "",
    lastName: user.lastName || "",
    username: user.username || "",
    email: user.email || "",
  };
}

function getInitials(name) {
  return (
    String(name || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("") || "?"
  );
}

function ProfileField({ label, icon, value, action }) {
  return (
    <div className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-black/45">
        {label}
      </span>
      <div className="flex h-12 items-center gap-3 rounded-xl border border-black/10 bg-white px-4 shadow-sm">
        {icon ? <FontAwesomeIcon icon={icon} className="text-sm text-black/35" /> : null}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-black">{value || "-"}</span>
        {action}
      </div>
    </div>
  );
}

function SettingsCard({ icon, title, description, children, footer }) {
  return (
    <section className="overflow-hidden rounded-[24px] border border-black/8 bg-white shadow-panel">
      <div className="flex items-start gap-3 border-b border-black/8 px-5 py-4 sm:px-6">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/15 text-black">
          <FontAwesomeIcon icon={icon} />
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-black">{title}</h3>
          {description ? <p className="text-sm text-black/50">{description}</p> : null}
        </div>
      </div>
      <div className="px-5 py-5 sm:px-6">{children}</div>
      {footer ? (
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-black/8 bg-black/[0.02] px-5 py-3 sm:px-6">
          {footer}
        </div>
      ) : null}
    </section>
  );
}

function SettingsInput({ label, icon, hint, action, type = "text", ...inputProps }) {
  const inputId = useId();
  const [visible, setVisible] = useState(false);
  const isPassword = type === "password";

  return (
    <div>
      <label
        htmlFor={inputId}
        className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-black/45"
      >
        {label}
      </label>
      <div className="group flex h-12 items-center gap-3 rounded-xl border border-black/10 bg-white px-4 transition focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
        {icon ? (
          <FontAwesomeIcon icon={icon} className="text-sm text-black/35 transition group-focus-within:text-brand" />
        ) : null}
        <input
          id={inputId}
          {...inputProps}
          type={isPassword && visible ? "text" : type}
          className="min-w-0 flex-1 border-0 bg-transparent text-sm font-medium text-black outline-none placeholder:font-normal placeholder:text-black/35 read-only:text-black/60"
        />
        {isPassword ? (
          <button
            type="button"
            onClick={() => setVisible((current) => !current)}
            aria-label={visible ? "Hide password" : "Show password"}
            title={visible ? "Hide password" : "Show password"}
            className="-mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-black/45 transition hover:bg-brand/15 hover:text-black"
          >
            <FontAwesomeIcon icon={visible ? faEyeSlash : faEye} />
          </button>
        ) : null}
        {action}
      </div>
      {hint ? <p className="mt-1.5 text-xs text-black/45">{hint}</p> : null}
    </div>
  );
}

function SettingsSelect({ label, icon, hint, children, ...selectProps }) {
  const selectId = useId();

  return (
    <div>
      <label htmlFor={selectId} className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-black/45">
        {label}
      </label>
      <div className="group flex h-12 items-center gap-3 rounded-xl border border-black/10 bg-white px-4 transition focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
        {icon ? (
          <FontAwesomeIcon icon={icon} className="text-sm text-black/35 transition group-focus-within:text-brand" />
        ) : null}
        <select
          id={selectId}
          {...selectProps}
          className="min-w-0 flex-1 border-0 bg-transparent text-sm font-medium text-black outline-none"
        >
          {children}
        </select>
      </div>
      {hint ? <p className="mt-1.5 text-xs text-black/45">{hint}</p> : null}
    </div>
  );
}

// SKU numbers start at 1 and show at least three digits: 001, 002, ... 999, 1000.
function formatSkuNumber(number) {
  return String(number ?? "").padStart(3, "0");
}

function formatSkuLabel(item) {
  return item?.skuName ? `${item.skuName} - ${formatSkuNumber(item.skuNumber)}` : "";
}

function ModalShell({ title, description, onClose, children, footer, size = "md" }) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-[28px] bg-white shadow-panel sm:rounded-[28px] ${
          { md: "max-w-md", lg: "max-w-xl", xl: "max-w-3xl" }[size]
        }`}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-black/8 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-black">{title}</h3>
            {description ? <p className="mt-0.5 text-sm text-black/55">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-black/60 transition hover:bg-black/5 hover:text-black"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer ? (
          <div className="flex shrink-0 justify-end gap-3 border-t border-black/8 bg-black/[0.02] px-5 py-3">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

function getBrowserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

function getDateInputValueDaysAgo(days) {
  const date = new Date();

  date.setDate(date.getDate() - days);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatDateInputLabel(value) {
  const [year, month, day] = value.split("-").map(Number);

  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getDashboardRangePresets() {
  const today = getTodayDateInputValue();
  const firstOfMonth = `${today.slice(0, 8)}01`;

  return [
    { label: "Today", from: today, to: today },
    { label: "7 days", from: getDateInputValueDaysAgo(6), to: today },
    { label: "30 days", from: getDateInputValueDaysAgo(29), to: today },
    { label: "This month", from: firstOfMonth, to: today },
  ];
}

function DashboardStatCard({ icon, label, value, sub, tone = "default" }) {
  const tones = {
    default: "border-black/8 bg-white",
    dark: "border-black bg-black text-white",
    warning: "border-amber-200 bg-amber-50",
  };
  const iconTones = {
    default: "bg-brand/15 text-black",
    dark: "bg-brand text-black",
    warning: "bg-amber-100 text-amber-700",
  };

  return (
    <article className={`rounded-[24px] border p-5 shadow-panel ${tones[tone]}`}>
      <div className="flex items-center justify-between gap-3">
        <p className={`text-xs font-semibold uppercase tracking-[0.14em] ${tone === "dark" ? "text-white/60" : "text-black/45"}`}>
          {label}
        </p>
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${iconTones[tone]}`}>
          <FontAwesomeIcon icon={icon} />
        </span>
      </div>
      <p className="mt-3 truncate text-3xl font-bold">{value}</p>
      {sub ? (
        <p className={`mt-1 truncate text-sm ${tone === "dark" ? "text-white/60" : "text-black/50"}`}>{sub}</p>
      ) : null}
    </article>
  );
}

function getStockRowTone(stock, threshold) {
  if (Number(stock) <= 0) {
    return { row: "bg-red-50 hover:bg-red-100/70 shadow-[inset_4px_0_0_#dc2626]", text: "font-bold text-red-700" };
  }

  if (Number(stock) <= threshold) {
    return { row: "bg-orange-50 hover:bg-orange-100/70 shadow-[inset_4px_0_0_#f97316]", text: "font-bold text-orange-700" };
  }

  return { row: "bg-white", text: "font-medium text-black/70" };
}

function getBranchInventoryStock(item) {
  return Number(item.branchStock ?? item.branches?.[0]?.stocks ?? 0);
}

const fullAccessPermissions = {
  sections: { dashboard: true, profile: true, inventory: true, branches: true },
  branchAccess: { mode: "all", branchIds: [] },
  accountSettings: true,
  manageAccounts: true,
  businessSettings: true,
};

const sectionPermissionKeys = {
  Dashboard: "dashboard",
  Profile: "profile",
  Inventory: "inventory",
  Branches: "branches",
};

function ToggleRow({ label, description, checked, onChange, disabled }) {
  return (
    <label
      className={`flex items-center justify-between gap-4 rounded-xl px-3 py-2.5 transition ${
        disabled ? "opacity-50" : "cursor-pointer hover:bg-black/[0.03]"
      }`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-black">{label}</span>
        {description ? <span className="block text-xs text-black/50">{description}</span> : null}
      </span>
      <span className="relative inline-flex shrink-0">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="h-6 w-11 rounded-full bg-black/15 transition peer-checked:bg-black peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40" />
        <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

function AccountsManager({ requestApi, branches }) {
  const [accounts, setAccounts] = useState(null);
  const [message, setMessage] = useState("");
  const [openId, setOpenId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    requestApi("/accounts")
      .then((payload) => setAccounts(payload.accounts))
      .catch((error) => setMessage(error.message));
  }, []);

  function openEditor(account) {
    if (openId === account.id) {
      setOpenId(null);
      setDraft(null);
      return;
    }

    setOpenId(account.id);
    setDraft(JSON.parse(JSON.stringify(account.permissions)));
  }

  function updateDraft(change) {
    setDraft((current) => change(JSON.parse(JSON.stringify(current))));
  }

  async function handleSave(account) {
    setSaving(true);

    try {
      const payload = await requestApi(`/accounts/${account.id}/permissions`, {
        method: "PUT",
        body: JSON.stringify({ permissions: draft }),
      });

      setAccounts((current) =>
        current.map((item) => (item.id === account.id ? { ...item, permissions: payload.permissions } : item)),
      );
      setOpenId(null);
      setDraft(null);
      await Swal.fire("Access saved", `${account.name} will see the new access the next time the page loads.`, "success");
    } catch (error) {
      await Swal.fire("Unable to save access", error.message, "error");
    } finally {
      setSaving(false);
    }
  }

  function describeAccess(permissions) {
    const sections = Object.entries(sectionPermissionKeys)
      .filter(([, key]) => permissions.sections[key])
      .map(([label]) => label);
    const branchText =
      permissions.branchAccess.mode === "all"
        ? "All branches"
        : `${permissions.branchAccess.branchIds.length} ${permissions.branchAccess.branchIds.length === 1 ? "branch" : "branches"}`;

    return `${sections.length ? sections.join(", ") : "No pages"} · ${branchText}`;
  }

  return (
    <SettingsCard
      icon={faUserGroup}
      title="Accounts"
      description="People who signed up with your business name and Business Code. Choose what each one can open."
    >
      {message ? <p className="text-sm text-red-600">{message}</p> : null}
      {!accounts && !message ? <p className="text-sm text-black/45">Loading accounts...</p> : null}

      <div className="space-y-3">
        {accounts?.map((account) => {
          const editable = account.role !== "owner" && !account.isSelf;
          const isOpen = openId === account.id && draft;

          return (
            <article key={account.id} className="overflow-hidden rounded-2xl border border-black/8">
              <div className="flex flex-wrap items-center gap-3 p-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand/20 text-sm font-semibold text-black">
                  {account.profileImage ? (
                    <img src={account.profileImage} alt="" className="h-full w-full object-cover" />
                  ) : (
                    getInitials(account.name)
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-black">
                    <span className="truncate">{account.name}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                        account.role === "owner" ? "bg-black text-white" : "bg-black/5 text-black/60"
                      }`}
                    >
                      {account.role === "owner" ? "Owner" : "Member"}
                    </span>
                    {account.isSelf ? (
                      <span className="rounded-full bg-brand/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-black">
                        You
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate text-sm text-black/50">
                    @{account.username} · {account.email}
                  </p>
                  <p className="truncate text-xs text-black/45">
                    {account.role === "owner" ? "Full access" : describeAccess(account.permissions)}
                  </p>
                </div>
                {editable ? (
                  <button
                    type="button"
                    onClick={() => openEditor(account)}
                    className={`inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition ${
                      isOpen ? "bg-black text-white" : "border border-black/10 text-black hover:bg-brand/15"
                    }`}
                  >
                    <FontAwesomeIcon icon={faPen} />
                    {isOpen ? "Close" : "Edit access"}
                  </button>
                ) : null}
              </div>

              {isOpen ? (
                <div className="space-y-5 border-t border-black/8 bg-black/[0.02] p-4">
                  <div>
                    <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-black/45">
                      Sidebar access
                    </p>
                    <div className="grid sm:grid-cols-2">
                      {Object.entries(sectionPermissionKeys).map(([label, key]) => (
                        <ToggleRow
                          key={key}
                          label={label}
                          checked={draft.sections[key]}
                          onChange={(checked) =>
                            updateDraft((next) => {
                              next.sections[key] = checked;
                              return next;
                            })
                          }
                        />
                      ))}
                    </div>
                  </div>

                  <div className="px-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-black/45">Branch access</p>
                    <div className="inline-flex rounded-xl bg-black/5 p-1">
                      {[
                        ["all", "All branches"],
                        ["selected", "Only some branches"],
                      ].map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() =>
                            updateDraft((next) => {
                              next.branchAccess.mode = mode;
                              return next;
                            })
                          }
                          className={`h-9 rounded-lg px-4 text-sm font-semibold transition ${
                            draft.branchAccess.mode === mode ? "bg-white text-black shadow-sm" : "text-black/55 hover:text-black"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {draft.branchAccess.mode === "selected" ? (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {branches.length === 0 ? <p className="text-sm text-black/45">No branches yet.</p> : null}
                        {branches.map((branch) => {
                          const checked = draft.branchAccess.branchIds.includes(branch.id);

                          return (
                            <label
                              key={branch.id}
                              className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                                checked ? "border-black bg-white text-black" : "border-black/10 text-black/70 hover:bg-white"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) =>
                                  updateDraft((next) => {
                                    next.branchAccess.branchIds = event.target.checked
                                      ? [...next.branchAccess.branchIds, branch.id]
                                      : next.branchAccess.branchIds.filter((id) => id !== branch.id);
                                    return next;
                                  })
                                }
                                className="h-4 w-4 accent-black"
                              />
                              <FontAwesomeIcon icon={faBuilding} className="text-black/40" />
                              <span className="truncate">{branch.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-black/45">Settings access</p>
                    {[
                      ["accountSettings", "Account settings", "Change their own name, email, password, and pictures."],
                      ["manageAccounts", "Account associates", "Open this Accounts tab and change other members' access."],
                      ["businessSettings", "Business settings", "Business name, logo, low stock level, SKUs and categories, branch names and codes."],
                    ].map(([key, label, description]) => (
                      <ToggleRow
                        key={key}
                        label={label}
                        description={description}
                        checked={draft[key]}
                        onChange={(checked) =>
                          updateDraft((next) => {
                            next[key] = checked;
                            return next;
                          })
                        }
                      />
                    ))}
                  </div>

                  <div className="flex justify-end gap-2 border-t border-black/8 pt-4">
                    <button
                      type="button"
                      onClick={() => openEditor(account)}
                      className="h-10 rounded-xl px-4 text-sm font-semibold text-black/60 transition hover:bg-black/5 hover:text-black"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSave(account)}
                      disabled={saving}
                      className="inline-flex h-10 items-center justify-center rounded-xl bg-black px-5 text-sm font-semibold text-white transition hover:bg-black/85 disabled:opacity-40"
                    >
                      {saving ? "Saving..." : "Save access"}
                    </button>
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </SettingsCard>
  );
}

const skuGridClass = "grid min-w-[600px] grid-cols-[110px_1fr_200px]";
// Same width and Actions column as the SKU table, so the category rows line up under it.
const categoryGridClass = "grid min-w-[600px] grid-cols-[1fr_200px]";
const skuInputClass =
  "h-10 w-full min-w-0 rounded-xl border border-black/10 bg-white px-3 text-sm font-medium text-black outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20";
const skuActionClass =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition disabled:opacity-40";

function SkuManager({ requestApi, branches }) {
  const [skus, setSkus] = useState(null);
  const [message, setMessage] = useState("");
  const [skuDraft, setSkuDraft] = useState(null);
  const [expandedSkuIds, setExpandedSkuIds] = useState([]);
  const [addingCategorySkuId, setAddingCategorySkuId] = useState(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [categoryDraft, setCategoryDraft] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    requestApi("/skus")
      .then((payload) => setSkus(payload.skus))
      .catch((error) => setMessage(error.message));
  }, []);

  function replaceSku(sku) {
    setSkus((current) => current.map((item) => (item.id === sku.id ? sku : item)));
  }

  function startAddSku() {
    setSkuDraft({ id: null, sku: "", branchId: "" });
  }

  function startEditSku(sku) {
    setSkuDraft({ id: sku.id, sku: sku.sku, branchId: sku.branchId ? String(sku.branchId) : "" });
  }

  // The chevron shows/hides the list. The + in the category header opens the new-category row.
  function toggleCategories(sku) {
    setExpandedSkuIds((current) =>
      current.includes(sku.id) ? current.filter((id) => id !== sku.id) : [...current, sku.id],
    );
    setCategoryDraft(null);
  }

  function startAddCategory(sku) {
    setAddingCategorySkuId(sku.id);
    setNewCategoryName("");
    setExpandedSkuIds((current) => (current.includes(sku.id) ? current : [...current, sku.id]));
  }

  async function handleSkuSave(event) {
    event.preventDefault();

    const isNew = skuDraft.id === null;

    setBusy("sku");

    try {
      const payload = await requestApi(isNew ? "/skus" : `/skus/${skuDraft.id}`, {
        method: isNew ? "POST" : "PATCH",
        body: JSON.stringify({ sku: skuDraft.sku.trim(), branchId: skuDraft.branchId ? Number(skuDraft.branchId) : null }),
      });

      setSkus((current) => (isNew ? [...current, payload.sku] : current.map((item) => (item.id === payload.sku.id ? payload.sku : item))));
      setSkuDraft(null);
    } catch (error) {
      await Swal.fire(isNew ? "Unable to add SKU" : "Unable to save SKU", error.message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function handleSkuDelete(sku) {
    const confirmation = await Swal.fire({
      title: "Delete SKU?",
      html: `This removes <b>${escapeHtml(`${sku.sku} - ${formatSkuNumber(sku.skuNumber)}`)}</b> and its ${sku.categories.length} ${
        sku.categories.length === 1 ? "category" : "categories"
      }. Inventory items using it will have an empty SKU and category until you pick new ones.<br><br>Its number is not reused.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Delete SKU",
      confirmButtonColor: "#dc2626",
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    setBusy(`delete-sku-${sku.id}`);

    try {
      await requestApi(`/skus/${sku.id}`, { method: "DELETE" });
      setSkus((current) => current.filter((item) => item.id !== sku.id));
      setExpandedSkuIds((current) => current.filter((id) => id !== sku.id));
      setAddingCategorySkuId((current) => (current === sku.id ? null : current));
    } catch (error) {
      await Swal.fire("Unable to delete SKU", error.message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function handleCategoryAdd(event, sku) {
    event.preventDefault();
    setBusy("category-add");

    try {
      const payload = await requestApi(`/skus/${sku.id}/categories`, {
        method: "POST",
        body: JSON.stringify({ categoryName: newCategoryName.trim() }),
      });

      replaceSku(payload.sku);
      setNewCategoryName("");
      setAddingCategorySkuId(null);
    } catch (error) {
      await Swal.fire("Unable to add category", error.message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function handleCategorySave(event, sku) {
    event.preventDefault();
    setBusy("category-edit");

    try {
      const payload = await requestApi(`/skus/${sku.id}/categories/${categoryDraft.id}`, {
        method: "PATCH",
        body: JSON.stringify({ categoryName: categoryDraft.categoryName.trim() }),
      });

      replaceSku(payload.sku);
      setCategoryDraft(null);
    } catch (error) {
      await Swal.fire("Unable to save category", error.message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function handleCategoryDelete(sku, category) {
    const confirmation = await Swal.fire({
      title: "Delete category?",
      html: `This removes <b>${escapeHtml(category.categoryName)}</b> from ${escapeHtml(sku.sku)}. Inventory items using it keep their SKU but will have an empty category until you pick a new one.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Delete category",
      confirmButtonColor: "#dc2626",
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    setBusy(`delete-category-${category.id}`);

    try {
      const payload = await requestApi(`/skus/${sku.id}/categories/${category.id}`, { method: "DELETE" });

      replaceSku(payload.sku);
    } catch (error) {
      await Swal.fire("Unable to delete category", error.message, "error");
    } finally {
      setBusy(null);
    }
  }

  function renderSkuForm() {
    return (
      <form onSubmit={handleSkuSave} className={`${skuGridClass} items-center gap-3 bg-brand/10 px-4 py-3 text-sm`}>
        <p className="font-semibold text-black/45">
          {skuDraft.id === null ? "New" : formatSkuNumber(skus.find((sku) => sku.id === skuDraft.id)?.skuNumber)}
        </p>
        <div className="flex min-w-0 gap-2">
          <input
            value={skuDraft.sku}
            onChange={(event) => setSkuDraft((current) => ({ ...current, sku: event.target.value }))}
            placeholder="SKU name"
            maxLength={120}
            aria-label="SKU name"
            autoFocus
            required
            className={skuInputClass}
          />
          <select
            value={skuDraft.branchId}
            onChange={(event) => setSkuDraft((current) => ({ ...current, branchId: event.target.value }))}
            aria-label="Branch"
            className={`${skuInputClass} max-w-[170px]`}
          >
            <option value="">All branches</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy === "sku" || !skuDraft.sku.trim()}
            className={`${skuActionClass} border-black bg-black text-white hover:bg-black/85`}
          >
            <FontAwesomeIcon icon={faCircleCheck} />
            {busy === "sku" ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={() => setSkuDraft(null)}
            className={`${skuActionClass} border-black/10 text-black/60 hover:bg-black/5 hover:text-black`}
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  function renderCategoryAddRow(sku) {
    return (
      <form
        onSubmit={(event) => handleCategoryAdd(event, sku)}
        className={`${categoryGridClass} items-center gap-3 border-t border-brand/30 bg-brand/[0.06] px-4 py-3`}
      >
        <input
          value={newCategoryName}
          onChange={(event) => setNewCategoryName(event.target.value)}
          placeholder={`New category for ${sku.sku}`}
          maxLength={120}
          aria-label="New category name"
          autoFocus
          required
          className={skuInputClass}
        />
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy === "category-add" || !newCategoryName.trim()}
            className={`${skuActionClass} border-black bg-black text-white hover:bg-black/85`}
          >
            <FontAwesomeIcon icon={faCircleCheck} />
            {busy === "category-add" ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={() => setAddingCategorySkuId(null)}
            className={`${skuActionClass} border-black/10 text-black/60 hover:bg-black/5 hover:text-black`}
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  function renderCategories(sku) {
    return (
      <div className="bg-brand/[0.06]">
        <div className={`${categoryGridClass} gap-3 border-t border-brand/30 bg-brand/20 px-4 py-3 text-xs font-semibold uppercase text-black/60`}>
          <span>{sku.sku} categories</span>
          <span className="flex items-center gap-2">
            Actions
            <button
              type="button"
              onClick={() => startAddCategory(sku)}
              disabled={addingCategorySkuId === sku.id}
              aria-label={`Add category to ${sku.sku}`}
              title="Add category"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-black text-white transition hover:bg-black/80 disabled:opacity-40"
            >
              <FontAwesomeIcon icon={faPlus} className="text-[10px]" />
            </button>
          </span>
        </div>

        {addingCategorySkuId === sku.id ? renderCategoryAddRow(sku) : null}

        {sku.categories.length === 0 ? (
          <p className="border-t border-brand/30 px-4 py-3 text-sm text-black/45">No categories yet.</p>
        ) : null}

        {sku.categories.map((category) =>
          categoryDraft?.id === category.id ? (
            <form
              key={category.id}
              onSubmit={(event) => handleCategorySave(event, sku)}
              className={`${categoryGridClass} items-center gap-3 border-t border-brand/30 px-4 py-3`}
            >
              <input
                value={categoryDraft.categoryName}
                onChange={(event) => setCategoryDraft((current) => ({ ...current, categoryName: event.target.value }))}
                maxLength={120}
                aria-label="Category name"
                autoFocus
                required
                className={skuInputClass}
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={busy === "category-edit" || !categoryDraft.categoryName.trim()}
                  className={`${skuActionClass} border-black bg-black text-white hover:bg-black/85`}
                >
                  <FontAwesomeIcon icon={faCircleCheck} />
                  {busy === "category-edit" ? "Saving..." : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setCategoryDraft(null)}
                  className={`${skuActionClass} border-black/10 text-black/60 hover:bg-black/5 hover:text-black`}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div
              key={category.id}
              className={`${categoryGridClass} items-center gap-3 border-t border-brand/30 px-4 py-3 text-sm`}
            >
              <p className="truncate font-medium text-black">{category.categoryName}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCategoryDraft({ id: category.id, categoryName: category.categoryName })}
                  className={`${skuActionClass} border-black/10 text-black hover:bg-black/5`}
                >
                  <FontAwesomeIcon icon={faPen} />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleCategoryDelete(sku, category)}
                  disabled={busy === `delete-category-${category.id}`}
                  className={`${skuActionClass} border-red-200 text-red-600 hover:bg-red-50`}
                >
                  <FontAwesomeIcon icon={faTrashCan} />
                  Delete
                </button>
              </div>
            </div>
          ),
        )}
      </div>
    );
  }

  return (
    <SettingsCard
      icon={faBarcode}
      title="SKUs"
      description="Group inventory by SKU and category. Numbers count up per business and are never reused."
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-black/50">
          {skus?.length ? "Every inventory item must use one of these SKUs." : "Once you add a SKU, every inventory item must use one."}
        </p>
        <button
          type="button"
          onClick={startAddSku}
          disabled={!skus || skuDraft?.id === null}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-black transition hover:brightness-95 disabled:opacity-50"
        >
          <FontAwesomeIcon icon={faPlus} />
          Add SKU
        </button>
      </div>

      {message ? <p className="text-sm text-red-600">{message}</p> : null}
      {!skus && !message ? <p className="text-sm text-black/45">Loading SKUs...</p> : null}

      {skus ? (
        <div className="overflow-x-auto rounded-2xl border border-black/8">
          <div className={`${skuGridClass} gap-3 bg-black px-4 py-3 text-xs font-semibold uppercase text-white/65`}>
            <span>SKU number</span>
            <span>SKU name</span>
            <span>Actions</span>
          </div>

          {skuDraft?.id === null ? renderSkuForm() : null}

          {skus.length === 0 && skuDraft?.id !== null ? (
            <p className="px-4 py-8 text-center text-sm text-black/50">No SKUs yet. Click Add SKU to create the first one.</p>
          ) : null}

          {skus.map((sku) => (
            <div key={sku.id} className="border-t border-black/8 first:border-t-0">
              {skuDraft?.id === sku.id ? (
                renderSkuForm()
              ) : (
                <div className={`${skuGridClass} items-center gap-3 px-4 py-3 text-sm`}>
                  <p className="font-semibold text-black/70">{formatSkuNumber(sku.skuNumber)}</p>
                  <div className="flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleCategories(sku)}
                      aria-expanded={expandedSkuIds.includes(sku.id)}
                      aria-label={`${expandedSkuIds.includes(sku.id) ? "Hide" : "Show"} ${sku.sku} categories`}
                      title={expandedSkuIds.includes(sku.id) ? "Hide categories" : "Show categories"}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-black/50 transition hover:bg-brand/15 hover:text-black"
                    >
                      <FontAwesomeIcon
                        icon={faChevronDown}
                        className={`text-xs transition-transform ${expandedSkuIds.includes(sku.id) ? "" : "rotate-180"}`}
                      />
                    </button>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-black">{sku.sku}</p>
                      <p className="truncate text-xs text-black/45">
                        {sku.branchName || "All branches"} · {sku.categories.length}{" "}
                        {sku.categories.length === 1 ? "category" : "categories"}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => startEditSku(sku)}
                      className={`${skuActionClass} border-black/10 text-black hover:bg-black/5`}
                    >
                      <FontAwesomeIcon icon={faPen} />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSkuDelete(sku)}
                      disabled={busy === `delete-sku-${sku.id}`}
                      className={`${skuActionClass} border-red-200 text-red-600 hover:bg-red-50`}
                    >
                      <FontAwesomeIcon icon={faTrashCan} />
                      Delete
                    </button>
                  </div>
                </div>
              )}

              {expandedSkuIds.includes(sku.id) ? renderCategories(sku) : null}
            </div>
          ))}
        </div>
      ) : null}
    </SettingsCard>
  );
}

function BranchModal({ mode, branch, onClose, onEdit, onSave, onToggle, onDelete }) {
  const [form, setForm] = useState(() => ({
    name: branch?.name || "",
    details: branch?.details || "",
    posCode: branch?.posCode || "",
  }));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null);
  const isView = mode === "view";
  const title = { view: "Branch details", add: "Add branch", edit: "Edit branch" }[mode];
  const description = {
    view: branch?.name,
    add: "Each branch signs in to the POS with its own code.",
    edit: branch?.name,
  }[mode];

  async function run(action, task) {
    setBusy(action);
    setError("");

    try {
      await task();
    } catch (taskError) {
      setError(taskError.message);
    } finally {
      setBusy(null);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();

    const values = {
      name: form.name.trim(),
      details: form.details.trim(),
      posCode: form.posCode.trim(),
    };

    if (!values.name || !values.posCode) {
      setError("Branch name and code for POS are required.");
      return;
    }

    run("save", () => onSave(values));
  }

  return (
    <ModalShell title={title} description={description} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {isView ? (
          <div className="flex items-center justify-between rounded-xl bg-black/[0.03] px-4 py-3">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-black/45">Status</span>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                branch.isDisabled ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"
              }`}
            >
              {branch.isDisabled ? "Disabled" : "Active"}
            </span>
          </div>
        ) : null}

        <SettingsInput
          label="Branch name"
          icon={faBuilding}
          value={form.name}
          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          placeholder="e.g. Main Street"
          readOnly={isView}
          autoFocus={!isView}
          required
        />
        <div>
          <label
            htmlFor="branch-details"
            className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-black/45"
          >
            Details {isView ? null : <span className="normal-case tracking-normal text-black/35">(optional)</span>}
          </label>
          <textarea
            id="branch-details"
            value={form.details}
            onChange={(event) => setForm((current) => ({ ...current, details: event.target.value }))}
            placeholder="Address, contact person, phone, opening hours..."
            readOnly={isView}
            rows={3}
            maxLength={1000}
            className="block w-full resize-y rounded-xl border border-black/10 bg-white px-4 py-3 text-sm font-medium text-black outline-none transition placeholder:font-normal placeholder:text-black/35 read-only:resize-none read-only:text-black/60 focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
          {isView && !form.details ? <p className="mt-1 text-xs text-black/40">No details yet.</p> : null}
        </div>
        <SettingsInput
          label="Code for POS"
          icon={faKey}
          type="password"
          autoComplete="new-password"
          value={form.posCode}
          onChange={(event) => setForm((current) => ({ ...current, posCode: event.target.value }))}
          placeholder="Code the branch types to sign in"
          readOnly={isView}
          hint={isView ? undefined : "Must be different from your other branches."}
          required
        />

        {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="h-11 rounded-xl px-4 text-sm font-semibold text-black/60 transition hover:bg-black/5 hover:text-black"
          >
            {isView ? "Close" : "Cancel"}
          </button>
          {isView ? (
            onEdit ? (
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-black px-5 text-sm font-semibold text-white transition hover:bg-black/85"
              >
                <FontAwesomeIcon icon={faPen} />
                Edit branch
              </button>
            ) : null
          ) : (
            <button
              type="submit"
              disabled={busy !== null}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-green-600 px-5 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
            >
              <FontAwesomeIcon icon={mode === "add" ? faPlus : faCircleCheck} />
              {busy === "save" ? "Saving..." : mode === "add" ? "Add branch" : "Save changes"}
            </button>
          )}
        </div>
      </form>

      {mode === "edit" ? (
        <div className="mt-6 space-y-3 border-t border-dashed border-black/15 pt-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-black/40">Branch status</p>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-black">
                {branch.isDisabled ? "Enable branch" : "Disable branch"}
              </p>
              <p className="text-xs text-black/55">
                {branch.isDisabled
                  ? "Lets this branch sign in to the POS again."
                  : "Stops POS sign-in for this branch. You can enable it later."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => run("toggle", onToggle)}
              disabled={busy !== null}
              className="h-10 shrink-0 rounded-xl bg-amber-400 px-4 text-sm font-semibold text-black transition hover:bg-amber-500 disabled:opacity-50"
            >
              {busy === "toggle" ? "Saving..." : branch.isDisabled ? "Enable" : "Disable"}
            </button>
          </div>

          <p className="pt-3 text-xs font-semibold uppercase tracking-[0.14em] text-red-700/70">Danger zone</p>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50/60 p-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-red-700">Delete branch</p>
              <p className="text-xs text-black/55">Removes this branch forever. This cannot be undone.</p>
            </div>
            <button
              type="button"
              onClick={() => run("delete", onDelete)}
              disabled={busy !== null}
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
            >
              <FontAwesomeIcon icon={faTrashCan} />
              Delete
            </button>
          </div>
        </div>
      ) : null}
    </ModalShell>
  );
}

const inventoryImageTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];

function getInventoryImageError(file) {
  if (!inventoryImageTypes.includes(file.type)) {
    return "Use a JPG, PNG, WebP, or GIF image.";
  }

  // The image is shrunk before upload, so this only guards against files too big to open.
  if (file.size > 15 * 1024 * 1024) {
    return "Image must be 15 MB or smaller.";
  }

  return "";
}

function Pagination({ page, pageSize, total, onChange, noun = "items" }) {
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);

  if (total <= pageSize) {
    return total > 0 ? (
      <p className="text-sm text-black/45">
        {total} {noun}
      </p>
    ) : null;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-black/55">
      <p>
        Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)} of {total} {noun}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          aria-label="Previous page"
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-black/10 text-black transition hover:bg-black/5 disabled:opacity-30"
        >
          <FontAwesomeIcon icon={faChevronLeft} />
        </button>
        <span className="min-w-12 text-center font-semibold text-black">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          aria-label="Next page"
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-black/10 text-black transition hover:bg-black/5 disabled:opacity-30"
        >
          <FontAwesomeIcon icon={faChevronRight} />
        </button>
      </div>
    </div>
  );
}

function FieldLabel({ htmlFor, children, optional }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-black/45">
      {children}
      {optional ? <span className="ml-1 normal-case tracking-normal text-black/35">(optional)</span> : null}
    </label>
  );
}

function InventoryImageField({ imageUrl, fileName, onFile }) {
  const galleryRef = useRef(null);
  const cameraRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  async function openCamera() {
    if (prefersNativeCamera()) {
      cameraRef.current?.click();
      return;
    }

    const file = await captureFromWebcam();

    if (file) {
      onFile(file);
    }
  }

  return (
    <div>
      <FieldLabel optional>Item image</FieldLabel>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);

          if (event.dataTransfer.files[0]) {
            onFile(event.dataTransfer.files[0]);
          }
        }}
        className={`flex items-center gap-4 rounded-2xl border border-dashed p-3 transition ${
          dragging ? "border-brand bg-brand/10" : "border-black/20 bg-black/[0.02]"
        }`}
      >
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-black/8 bg-white text-xl text-black/30">
          {imageUrl ? <img src={imageUrl} alt="" className="h-full w-full object-cover" /> : <FontAwesomeIcon icon={faImage} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-black">{fileName || (imageUrl ? "Current image" : "No image yet")}</p>
          <p className="text-xs text-black/45">Drop an image here, or choose one. JPG, PNG, WebP, or GIF up to 15 MB. It is resized automatically.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openCamera}
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-black/10 bg-white px-3 text-sm font-semibold text-black transition hover:bg-brand/15"
            >
              <FontAwesomeIcon icon={faCamera} />
              Camera
            </button>
            <button
              type="button"
              onClick={() => galleryRef.current?.click()}
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-black/10 bg-white px-3 text-sm font-semibold text-black transition hover:bg-brand/15"
            >
              <FontAwesomeIcon icon={faImage} />
              Gallery
            </button>
          </div>
        </div>
      </div>
      {[
        [galleryRef, { accept: inventoryImageTypes.join(",") }],
        [cameraRef, { accept: "image/*", capture: "environment" }],
      ].map(([ref, attributes], index) => (
        <input
          key={index}
          ref={ref}
          type="file"
          className="hidden"
          {...attributes}
          onChange={(event) => {
            const file = event.target.files?.[0];

            event.target.value = "";

            if (file) {
              onFile(file);
            }
          }}
        />
      ))}
    </div>
  );
}

function BranchAllocationList({ branches, item, mode, total, allocations, onChange }) {
  const currentStock = (branchId) =>
    Number(item?.branches.find((branch) => String(branch.id) === String(branchId))?.stocks || 0);
  const usable = (branch) => mode === "add" || currentStock(branch.id) > 0;
  const assigned = branches.reduce(
    (sum, branch) => sum + (allocations[branch.id]?.checked ? Number(allocations[branch.id].value || 0) : 0),
    0,
  );
  const remaining = total - assigned;
  const usableBranches = branches.filter(usable);
  const allChecked = usableBranches.length > 0 && usableBranches.every((branch) => allocations[branch.id]?.checked);

  function setRow(branchId, change) {
    onChange({ ...allocations, [branchId]: { checked: false, value: "", ...allocations[branchId], ...change } });
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <FieldLabel>Branches</FieldLabel>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            remaining === 0 && total > 0
              ? "bg-green-100 text-green-800"
              : remaining < 0
                ? "bg-red-100 text-red-700"
                : "bg-black/5 text-black/60"
          }`}
        >
          Unassigned: {remaining}
        </span>
      </div>
      <div className="overflow-hidden rounded-2xl border border-black/10">
        <label className="flex cursor-pointer items-center gap-3 border-b border-black/8 bg-black/[0.03] px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-black/50">
          <input
            type="checkbox"
            checked={allChecked}
            disabled={usableBranches.length === 0}
            onChange={(event) => {
              const next = { ...allocations };

              usableBranches.forEach((branch) => {
                next[branch.id] = {
                  value: event.target.checked ? next[branch.id]?.value || "" : "",
                  checked: event.target.checked,
                };
              });
              onChange(next);
            }}
            className="h-4 w-4 accent-black"
          />
          <span className="flex-1">Select all</span>
          {item ? <span className="w-16 text-right">Current</span> : null}
          <span className="w-24 text-right">{mode === "delete" ? "Remove" : "Stock"}</span>
        </label>
        <div className="max-h-60 overflow-y-auto">
          {branches.map((branch) => {
            const row = allocations[branch.id] || { checked: false, value: "" };
            const rowUsable = usable(branch);
            const value = Number(row.value || 0);
            const maxForRow = Math.max(
              mode === "delete" ? Math.min(remaining + value, currentStock(branch.id)) : remaining + value,
              0,
            );

            return (
              <div
                key={branch.id}
                className={`flex items-center gap-3 border-t border-black/8 px-4 py-2.5 first:border-t-0 ${
                  rowUsable ? "" : "opacity-40"
                }`}
              >
                <input
                  type="checkbox"
                  checked={row.checked}
                  disabled={!rowUsable}
                  onChange={(event) => setRow(branch.id, { checked: event.target.checked, value: "" })}
                  aria-label={branch.name}
                  className="h-4 w-4 accent-black"
                />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-black">{branch.name}</span>
                {item ? <span className="w-16 text-right text-sm text-black/55">{currentStock(branch.id)}</span> : null}
                <input
                  type="number"
                  min={1}
                  step={1}
                  max={maxForRow}
                  inputMode="numeric"
                  placeholder="0"
                  value={row.value}
                  disabled={!row.checked}
                  onChange={(event) => {
                    const nextValue = event.target.value === "" ? "" : Math.min(Number(event.target.value), maxForRow);

                    setRow(branch.id, { value: nextValue === "" ? "" : String(nextValue) });
                  }}
                  className="h-10 w-24 rounded-xl border border-black/10 px-3 text-right text-sm font-semibold text-black outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:bg-black/[0.03] disabled:text-black/30"
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function getAllocationList(allocations) {
  return Object.entries(allocations)
    .filter(([, row]) => row.checked)
    .map(([branchId, row]) => ({ branchId: Number(branchId), stocks: Number(row.value) }));
}

function validateAllocations(list, total) {
  if (list.length === 0) {
    return "Select at least one branch.";
  }

  if (list.some((allocation) => !Number.isInteger(allocation.stocks) || allocation.stocks <= 0)) {
    return "Fill stocks for every selected branch.";
  }

  if (list.reduce((sum, allocation) => sum + allocation.stocks, 0) !== total) {
    return "All stocks must be assigned to branches before saving.";
  }

  return "";
}

function DangerZone({ title, description, buttonLabel, onClick, busy }) {
  return (
    <div className="mt-6 border-t border-dashed border-black/15 pt-5">
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-red-700/70">Danger zone</p>
      <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50/60 p-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-red-700">{title}</p>
          <p className="text-xs text-black/55">{description}</p>
        </div>
        <button
          type="button"
          onClick={onClick}
          disabled={busy}
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
        >
          <FontAwesomeIcon icon={faTrashCan} />
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}

function ModalActions({ onCancel, busy, submitLabel, submitIcon = faCircleCheck, tone = "green" }) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <button
        type="button"
        onClick={onCancel}
        className="h-11 rounded-xl px-4 text-sm font-semibold text-black/60 transition hover:bg-black/5 hover:text-black"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={busy}
        className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold text-white transition disabled:opacity-50 ${
          tone === "red" ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"
        }`}
      >
        <FontAwesomeIcon icon={submitIcon} />
        {busy ? "Saving..." : submitLabel}
      </button>
    </div>
  );
}

function InventoryItemModal({ mode, item, branches, skus, canDelete, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(() => ({
    name: item?.name || "",
    price: item ? String(item.price ?? 0) : "",
    stocks: "",
    skuId: item?.skuId ? String(item.skuId) : "",
    categoryId: item?.categoryId ? String(item.categoryId) : "",
  }));
  const selectedSku = skus.find((sku) => String(sku.id) === form.skuId) || null;
  const skuCategories = selectedSku?.categories || [];
  const [allocations, setAllocations] = useState({});
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(getInventoryImageSrc(item));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isAdd = mode === "add";
  const totalStocks = Number.isInteger(Number(form.stocks)) && Number(form.stocks) > 0 ? Number(form.stocks) : 0;

  // Puts the whole stock on the first ticked branch, as long as no other ticked branch has its own amount yet.
  function fillFirstTickedBranch(next, total) {
    const ticked = branches.filter((branch) => next[branch.id]?.checked);

    if (ticked.length === 0 || ticked.slice(1).some((branch) => Number(next[branch.id].value || 0) > 0)) {
      return next;
    }

    return { ...next, [ticked[0].id]: { ...next[ticked[0].id], value: total > 0 ? String(total) : "" } };
  }

  function handleAllocationsChange(next) {
    const tickedIds = (value) =>
      branches
        .filter((branch) => value[branch.id]?.checked)
        .map((branch) => branch.id)
        .join();

    // Only refill when ticks change, so typing a split amount by hand is left alone.
    setAllocations(tickedIds(next) === tickedIds(allocations) ? next : fillFirstTickedBranch(next, totalStocks));
  }

  useEffect(() => {
    setAllocations((current) => fillFirstTickedBranch(current, totalStocks));
  }, [totalStocks]);

  function handleImageFile(file) {
    const imageError = getInventoryImageError(file);

    if (imageError) {
      setError(imageError);
      return;
    }

    setError("");
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const name = form.name.trim();
    const price = Number(form.price);

    if (!name) {
      setError("Item name is required.");
      return;
    }

    if (form.price === "" || !Number.isFinite(price) || price < 0) {
      setError("Price must be zero or greater.");
      return;
    }

    if (skus.length > 0 && !selectedSku) {
      setError("Select a SKU for this item.");
      return;
    }

    if (skuCategories.length > 0 && !form.categoryId) {
      setError("Select a category for this SKU.");
      return;
    }

    const values = {
      name,
      price,
      skuId: selectedSku ? selectedSku.id : null,
      categoryId: skuCategories.length > 0 ? Number(form.categoryId) : null,
    };

    if (isAdd) {
      const branchAllocations = getAllocationList(allocations);
      const allocationError = !totalStocks
        ? "Enter a stock count greater than zero."
        : validateAllocations(branchAllocations, totalStocks);

      if (allocationError) {
        setError(allocationError);
        return;
      }

      values.stocks = totalStocks;
      values.branchAllocations = branchAllocations;
    }

    setBusy(true);
    setError("");

    try {
      if (imageFile) {
        const shrunk = await shrinkImageFileToDataUrl(imageFile);

        values.imageData = shrunk.dataUrl;
        values.imageMime = shrunk.mime;
        values.imageName = imageFile.name;
      } else if (isAdd) {
        values.imageData = null;
        values.imageMime = null;
        values.imageName = null;
      }

      await onSave(values);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell
      size="lg"
      title={isAdd ? "Add inventory item" : "Edit inventory item"}
      description={isAdd ? "Set the price and split the starting stock across branches." : item.name}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <SettingsInput
          label="Item name"
          icon={faBoxesStacked}
          value={form.name}
          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          placeholder="e.g. Ash Browns"
          autoFocus
          required
        />
        {skus.length > 0 ? (
          <div className={`grid gap-4 ${skuCategories.length > 0 ? "sm:grid-cols-2" : ""}`}>
            <SettingsSelect
              label="SKU"
              icon={faBarcode}
              value={form.skuId}
              onChange={(event) => setForm((current) => ({ ...current, skuId: event.target.value, categoryId: "" }))}
              required
            >
              <option value="" disabled>
                Select a SKU
              </option>
              {skus.map((sku) => (
                <option key={sku.id} value={sku.id}>
                  {sku.sku} - {formatSkuNumber(sku.skuNumber)}
                  {sku.branchName ? ` (${sku.branchName})` : ""}
                </option>
              ))}
            </SettingsSelect>
            {skuCategories.length > 0 ? (
              <SettingsSelect
                label="Category"
                icon={faTags}
                value={form.categoryId}
                onChange={(event) => setForm((current) => ({ ...current, categoryId: event.target.value }))}
                required
              >
                <option value="" disabled>
                  Select a category
                </option>
                {skuCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.categoryName}
                  </option>
                ))}
              </SettingsSelect>
            ) : null}
          </div>
        ) : null}
        <div className={`grid gap-4 ${isAdd ? "sm:grid-cols-2" : ""}`}>
          <SettingsInput
            label="Price"
            icon={faCoins}
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={form.price}
            onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))}
            placeholder="0.00"
            required
          />
          {isAdd ? (
            <SettingsInput
              label="Total stock"
              icon={faBoxesStacked}
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={form.stocks}
              onChange={(event) => setForm((current) => ({ ...current, stocks: event.target.value }))}
              placeholder="0"
              required
            />
          ) : null}
        </div>

        <InventoryImageField imageUrl={imagePreview} fileName={imageFile?.name || item?.imageName} onFile={handleImageFile} />

        {isAdd ? (
          <BranchAllocationList
            branches={branches}
            mode="add"
            total={totalStocks}
            allocations={allocations}
            onChange={handleAllocationsChange}
          />
        ) : null}

        {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}

        <ModalActions
          onCancel={onClose}
          busy={busy}
          submitLabel={isAdd ? "Add item" : "Save changes"}
          submitIcon={isAdd ? faPlus : faCircleCheck}
        />
      </form>

      {!isAdd && canDelete ? (
        <DangerZone
          title="Delete item"
          description="Removes this item and its stock from every branch."
          buttonLabel="Delete"
          busy={busy}
          onClick={onDelete}
        />
      ) : null}
    </ModalShell>
  );
}

function InventoryStockModal({ item, branches, branch, onClose, onSave }) {
  const [stockMode, setStockMode] = useState("add");
  const [amount, setAmount] = useState("");
  const [allocations, setAllocations] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const total = Number.isInteger(Number(amount)) && Number(amount) > 0 ? Number(amount) : 0;
  const branchStock = branch
    ? Number(item.branches.find((entry) => String(entry.id) === String(branch.id))?.stocks || 0)
    : 0;
  const after = stockMode === "delete" ? branchStock - total : branchStock + total;

  async function handleSubmit(event) {
    event.preventDefault();

    if (!total) {
      setError("Enter a stock count greater than zero.");
      return;
    }

    let values;

    if (branch) {
      if (stockMode === "delete" && total > branchStock) {
        setError("You cannot remove more than this branch has.");
        return;
      }

      values = { mode: stockMode, stocks: total, branchId: Number(branch.id) };
    } else {
      const branchAllocations = getAllocationList(allocations);
      const allocationError = validateAllocations(branchAllocations, total);

      if (allocationError) {
        setError(allocationError);
        return;
      }

      values = { mode: stockMode, stocks: total, branchAllocations };
    }

    setBusy(true);
    setError("");

    try {
      await onSave(values);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell
      size="lg"
      title={branch ? `Update stock · ${branch.name}` : "Update stock"}
      description={item.name}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 rounded-xl bg-black/5 p-1">
          {[
            ["add", "Add stock", faPlus],
            ["delete", "Remove stock", faArrowDown],
          ].map(([value, label, icon]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setStockMode(value);
                setAmount("");
                setAllocations({});
                setError("");
              }}
              className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition ${
                stockMode === value
                  ? value === "add"
                    ? "bg-green-600 text-white shadow-sm"
                    : "bg-red-600 text-white shadow-sm"
                  : "text-black/55 hover:text-black"
              }`}
            >
              <FontAwesomeIcon icon={icon} />
              {label}
            </button>
          ))}
        </div>

        <SettingsInput
          label={stockMode === "delete" ? "Stock to remove" : "Stock to add"}
          icon={faBoxesStacked}
          type="number"
          min={1}
          step={1}
          max={branch && stockMode === "delete" ? branchStock : undefined}
          inputMode="numeric"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="0"
          autoFocus
          required
        />

        {branch ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-black/[0.03] px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-black/45">Current</p>
              <p className="mt-1 text-xl font-bold text-black">{branchStock}</p>
            </div>
            <div className={`rounded-xl px-4 py-3 ${after < 0 ? "bg-red-50" : "bg-black text-white"}`}>
              <p className={`text-xs font-semibold uppercase tracking-[0.12em] ${after < 0 ? "text-red-700" : "text-white/55"}`}>
                After {stockMode === "delete" ? "removing" : "adding"}
              </p>
              <p className={`mt-1 text-xl font-bold ${after < 0 ? "text-red-700" : ""}`}>{after}</p>
            </div>
          </div>
        ) : (
          <BranchAllocationList
            branches={branches}
            item={item}
            mode={stockMode}
            total={total}
            allocations={allocations}
            onChange={setAllocations}
          />
        )}

        {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}

        <ModalActions
          onCancel={onClose}
          busy={busy}
          submitLabel={stockMode === "delete" ? "Remove stock" : "Add stock"}
          submitIcon={stockMode === "delete" ? faArrowDown : faPlus}
          tone={stockMode === "delete" ? "red" : "green"}
        />
      </form>
    </ModalShell>
  );
}

const inventoryHistoryPageSize = 8;

function InventoryHistoryModal({ item, requestApi, onClose }) {
  const [tab, setTab] = useState("stock");
  const [pages, setPages] = useState({ stock: 1, price: 1 });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      stockPage: String(pages.stock),
      pricePage: String(pages.price),
      limit: String(inventoryHistoryPageSize),
    });

    setLoading(true);
    requestApi(`/inventory/${item.id}/history?${params.toString()}`)
      .then((payload) => {
        if (!cancelled) {
          setData(payload);
          setError("");
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError.message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [item.id, pages.stock, pages.price]);

  const rows = tab === "stock" ? data?.history || [] : data?.priceHistory || [];
  const total = tab === "stock" ? data?.stockTotal || 0 : data?.priceTotal || 0;

  return (
    <ModalShell size="lg" title="Inventory history" description={item.name} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 rounded-xl bg-black/5 p-1">
          {[
            ["stock", "Stock history", data?.stockTotal],
            ["price", "Price history", data?.priceTotal],
          ].map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition ${
                tab === value ? "bg-white text-black shadow-sm" : "text-black/55 hover:text-black"
              }`}
            >
              {label}
              {count ? <span className="rounded-full bg-black/5 px-1.5 text-xs">{count}</span> : null}
            </button>
          ))}
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className={`overflow-hidden rounded-2xl border border-black/8 transition ${loading && data ? "opacity-50" : ""}`}>
          {!data && loading ? <p className="px-4 py-8 text-center text-sm text-black/50">Loading history...</p> : null}
          {data && rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-black/50">
              {tab === "stock" ? "No stock history yet." : "No price history yet."}
            </p>
          ) : null}
          {rows.map((entry, index) =>
            tab === "stock" ? (
              <div
                key={entry.id}
                className={`flex items-center gap-3 px-4 py-3 ${index > 0 ? "border-t border-black/8" : ""}`}
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm ${
                    entry.action === "delete" ? "bg-red-50 text-red-600" : "bg-green-50 text-green-700"
                  }`}
                >
                  <FontAwesomeIcon icon={entry.action === "delete" ? faArrowDown : faArrowUp} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-black">{entry.branchName || "Removed branch"}</p>
                  <p className="truncate text-xs text-black/50">
                    {new Date(entry.createdAt).toLocaleString()}
                    {entry.createdByName ? ` · ${entry.createdByName}` : ""}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-sm font-bold ${entry.action === "delete" ? "text-red-600" : "text-green-700"}`}
                >
                  {entry.action === "delete" ? "-" : "+"}
                  {entry.quantity}
                </span>
              </div>
            ) : (
              <div
                key={entry.id}
                className={`flex items-center gap-3 px-4 py-3 ${index > 0 ? "border-t border-black/8" : ""}`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand/15 text-sm text-black">
                  <FontAwesomeIcon icon={faCoins} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-black">
                    {entry.oldPrice === null ? "Initial price" : formatMoney(entry.oldPrice)}
                    <FontAwesomeIcon icon={faArrowRight} className="mx-2 text-xs text-black/35" />
                    {formatMoney(entry.newPrice)}
                  </p>
                  <p className="truncate text-xs text-black/50">
                    {new Date(entry.createdAt).toLocaleString()}
                    {entry.createdByName ? ` · ${entry.createdByName}` : ""}
                  </p>
                </div>
              </div>
            ),
          )}
        </div>

        <Pagination
          page={pages[tab]}
          pageSize={inventoryHistoryPageSize}
          total={total}
          noun="entries"
          onChange={(nextPage) => setPages((current) => ({ ...current, [tab]: nextPage }))}
        />
      </div>
    </ModalShell>
  );
}

function InventoryImageModal({ item, onClose }) {
  return (
    <ModalShell size="xl" title={item.name} description={item.imageName || undefined} onClose={onClose}>
      <div className="flex min-h-[240px] items-center justify-center rounded-2xl bg-[repeating-conic-gradient(#f4f4f4_0_25%,#fff_0_50%)] bg-[length:20px_20px] p-2">
        {item.imageUrl ? (
          <img
            src={getInventoryImageSrc(item)}
            loading="lazy"
            alt={item.imageName || item.name}
            className="max-h-[65dvh] w-auto max-w-full rounded-xl object-contain shadow-panel"
          />
        ) : (
          <div className="text-center text-black/40">
            <FontAwesomeIcon icon={faImage} className="text-4xl" />
            <p className="mt-2 text-sm">This item has no image yet.</p>
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="text-black/55">
          #{item.id} · Price <b className="text-black">{formatMoney(item.price)}</b>
        </span>
        <button
          type="button"
          onClick={onClose}
          className="h-10 rounded-xl bg-black px-5 text-sm font-semibold text-white transition hover:bg-black/85"
        >
          Close
        </button>
      </div>
    </ModalShell>
  );
}

function getSaleStatus(sale) {
  if (sale.isFullyReturned) {
    return { label: "Refunded", className: "bg-red-50 text-red-700" };
  }

  if (sale.returnedItems > 0) {
    return { label: "Partially refunded", className: "bg-amber-50 text-amber-700" };
  }

  return { label: "Completed", className: "bg-brand/15 text-green-800" };
}

function SaleStatusBadge({ sale }) {
  const status = getSaleStatus(sale);

  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${status.className}`}>
      {status.label}
    </span>
  );
}

function ReceiptModal({ receipt, loading, error, onClose }) {
  return (
    <ModalShell
      title={receipt ? `Receipt ${receipt.receiptCode}` : "Receipt"}
      description={
        receipt
          ? `${receipt.branchName} · ${new Date(receipt.createdAt).toLocaleString()}`
          : undefined
      }
      onClose={onClose}
    >
      {loading ? <p className="py-6 text-center text-sm text-black/55">Loading receipt...</p> : null}
      {error ? <p className="py-6 text-center text-sm text-red-600">{error}</p> : null}
      {receipt ? (
        <div className="space-y-4">
          <div className="max-h-[50vh] overflow-auto rounded-xl border border-black/8">
            {receipt.items.map((item, index) => (
              <div
                key={`${item.itemCode}-${index}`}
                className={`flex items-start justify-between gap-3 px-4 py-3 text-sm ${
                  index > 0 ? "border-t border-black/8" : ""
                }`}
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-black">{item.itemName}</p>
                  <p className="text-xs text-black/50">
                    {item.itemCode} · {formatMoney(item.unitPrice)} x {item.quantity}
                  </p>
                  {item.refundedQuantity > 0 ? (
                    <p className="mt-0.5 text-xs font-semibold text-red-600">
                      {item.refundedQuantity} refunded
                    </p>
                  ) : null}
                </div>
                <p className="shrink-0 font-semibold text-black">{formatMoney(item.totalPrice)}</p>
              </div>
            ))}
          </div>
          {(() => {
            const refundAmount = receipt.items.reduce(
              (sum, item) => sum + item.refundedQuantity * item.unitPrice,
              0,
            );

            return (
              <div className="space-y-2">
                {refundAmount > 0 ? (
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between text-black/55">
                      <span>Subtotal · {receipt.totalItems} items</span>
                      <span>{formatMoney(receipt.totalAmount)}</span>
                    </div>
                    <div className="flex justify-between font-semibold text-red-600">
                      <span>Refund · {receipt.returnedItems} items</span>
                      <span>-{formatMoney(refundAmount)}</span>
                    </div>
                  </div>
                ) : null}
                <div className="flex items-center justify-between border-t border-black/8 pt-3">
                  <SaleStatusBadge sale={receipt} />
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-[0.12em] text-black/45">
                      Total · {receipt.totalItems - receipt.returnedItems}{" "}
                      {receipt.totalItems - receipt.returnedItems === 1 ? "item" : "items"}
                    </p>
                    <p className="text-xl font-bold text-black">{formatMoney(receipt.totalAmount - refundAmount)}</p>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      ) : null}
    </ModalShell>
  );
}

function ImagePickerButton({ id, children, onFile, disabled, className }) {
  return (
    <>
      <label
        htmlFor={id}
        className={`inline-flex cursor-pointer items-center justify-center gap-2 transition ${
          disabled ? "pointer-events-none opacity-60" : ""
        } ${className}`}
      >
        {children}
      </label>
      <input
        id={id}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];

          event.target.value = "";

          if (file) {
            onFile(file);
          }
        }}
      />
    </>
  );
}

function SaveButton({ busy, disabled, children, ...props }) {
  return (
    <button
      type="submit"
      disabled={busy || disabled}
      {...props}
      className="inline-flex h-10 items-center justify-center rounded-xl bg-black px-5 text-sm font-semibold text-white transition hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {busy ? "Saving..." : children}
    </button>
  );
}

function formatMoney(value) {
  const numberValue = Number(value || 0);

  return numberValue.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function removeSavedAuth() {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Browser storage can be unavailable in strict privacy modes.
  }

  clearApiCache();
}

// Last response per user and path, shown instantly on the next visit while fresh data loads.
const apiCachePrefix = "cowflo-cache:";

function getApiCacheKey(userId, path) {
  return `${apiCachePrefix}${userId}:${path}`;
}

function readApiCache(userId, path) {
  try {
    const raw = window.localStorage.getItem(getApiCacheKey(userId, path));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeApiCache(userId, path, payload) {
  try {
    window.localStorage.setItem(getApiCacheKey(userId, path), JSON.stringify(payload));
  } catch {
    // Storage full or unavailable: the page still works, it just loads from the server.
  }
}

function clearApiCache() {
  try {
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith(apiCachePrefix))
      .forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Browser storage can be unavailable in strict privacy modes.
  }
}

function readTokenPayload(token) {
  try {
    const encodedPayload = String(token || "").split(".")[1];

    if (!encodedPayload || typeof window === "undefined" || typeof window.atob !== "function") {
      return null;
    }

    const base64Payload = encodedPayload
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(encodedPayload.length / 4) * 4, "=");

    return JSON.parse(window.atob(base64Payload));
  } catch {
    return null;
  }
}

function getAuthExpiresAt(auth) {
  const payload = readTokenPayload(auth?.token);

  return Number.isFinite(payload?.exp) ? payload.exp * 1000 : null;
}

function isAuthExpired(auth) {
  const expiresAt = getAuthExpiresAt(auth);

  return expiresAt ? Date.now() >= expiresAt : false;
}

function readSavedAuth() {
  try {
    const saved = window.localStorage.getItem(storageKey);
    const parsed = saved ? JSON.parse(saved) : null;

    if (!parsed?.token || !parsed?.user || isAuthExpired(parsed)) {
      removeSavedAuth();
      return null;
    }

    return parsed;
  } catch {
    removeSavedAuth();
    return null;
  }
}

function saveAuth(auth) {
  try {
    if (auth) {
      window.localStorage.setItem(storageKey, JSON.stringify(auth));
      return;
    }

    removeSavedAuth();
  } catch {
    removeSavedAuth();
  }
}

function LogoMark({ className = "h-12 w-12" }) {
  return (
    <img
      src={cowfloLogo}
      alt="CowFlo logo"
      className={`${className} object-contain`}
      draggable="false"
    />
  );
}

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="flex min-h-screen items-center justify-center px-4">
          <section className="w-full max-w-md rounded-[28px] border border-black/10 bg-white p-8 text-center shadow-panel">
            <LogoMark className="mx-auto h-20 w-20" />
            <h1 className="mt-6 text-2xl font-semibold text-black">CowFlo could not load</h1>
            <p className="mt-3 text-sm leading-6 text-black/60">
              Refresh the page once. If it keeps happening, clear this site&apos;s browser storage and reload.
            </p>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

const authFieldClass =
  "group flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3.5 transition focus-within:border-brand focus-within:bg-white/[0.09] focus-within:ring-4 focus-within:ring-brand/20";
const authInputClass =
  "w-full border-0 bg-transparent text-sm text-white outline-none placeholder:text-white/40";

function InputField({ icon, type = "text", value, onChange, placeholder, autoComplete }) {
  return (
    <label className={authFieldClass}>
      <span className="text-white/45 transition group-focus-within:text-brand">
        <FontAwesomeIcon icon={icon} />
      </span>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required
        className={authInputClass}
      />
    </label>
  );
}

function PasswordField({ value, onChange, placeholder, autoComplete }) {
  const [visible, setVisible] = useState(false);

  return (
    <label className={authFieldClass}>
      <span className="text-white/45 transition group-focus-within:text-brand">
        <FontAwesomeIcon icon={faLock} />
      </span>
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required
        className={authInputClass}
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? "Hide password" : "Show password"}
        className="text-white/45 transition hover:text-brand"
      >
        <FontAwesomeIcon icon={visible ? faEyeSlash : faEye} />
      </button>
    </label>
  );
}

function AuthShell({ eyebrow, title, description, children, footer, wide = false }) {
  return (
    <main className="auth-card relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0b0f0b] px-4 py-10 text-white sm:px-6">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-green-700 via-brand to-green-700" />
        <div className="absolute -right-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-brand/15 blur-3xl" />
        <div className="absolute -bottom-40 -left-32 h-[32rem] w-[32rem] rounded-full bg-green-700/20 blur-3xl" />
      </div>

      <section className={`relative w-full ${wide ? "max-w-xl" : "max-w-md"} py-4`}>

        <div className="relative flex items-center justify-center gap-3">
          <LogoMark className="h-16 w-16 shrink-0 drop-shadow-[0_6px_18px_rgba(99,224,80,0.35)]" />
          <div className="text-left">
            <p className="text-3xl font-bold leading-none tracking-tight text-white">CowFlo</p>
            <p className="mt-1.5 text-sm font-medium text-brand">Keep Moo-ving. No Bull.</p>
          </div>
        </div>

        <div className="relative my-7 h-px bg-white/10" />

        <div className="relative mb-6 space-y-1.5 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand/80">{eyebrow}</p>
          <h1 className="text-xl font-semibold text-white sm:text-2xl">{title}</h1>
          <p className="text-sm leading-6 text-white/55">{description}</p>
        </div>

        <div className="relative">{children}</div>
        {footer ? <div className="relative mt-6 text-center">{footer}</div> : null}
      </section>
    </main>
  );
}

function Dashboard({ auth, onLogout, onUserUpdate }) {
  const navigate = useNavigate();
  const businessName = auth.user.businessName || "CowFlo";
  const username = auth.user.username || auth.user.name;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeSection, setActiveSection] = useState("Dashboard");
  const [branches, setBranches] = useState([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesMessage, setBranchesMessage] = useState("");
  const [inventoryFilter, setInventoryFilter] = useState("all");
  const [inventorySearch, setInventorySearch] = useState("");
  const [inventoryItems, setInventoryItems] = useState([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryMessage, setInventoryMessage] = useState("");
  const [skus, setSkus] = useState([]);
  const [branchInventoryItems, setBranchInventoryItems] = useState([]);
  const [branchInventoryLoading, setBranchInventoryLoading] = useState(false);
  const [branchInventoryMessage, setBranchInventoryMessage] = useState("");
  const [branchSales, setBranchSales] = useState(null);
  const [branchSalesLoading, setBranchSalesLoading] = useState(false);
  const [branchSalesMessage, setBranchSalesMessage] = useState("");
  const [branchSalesPage, setBranchSalesPage] = useState(1);
  const [branchSalesSearch, setBranchSalesSearch] = useState({ receipt: "", item: "" });
  const [branchReceipt, setBranchReceipt] = useState(null);
  const [branchReturnSection, setBranchReturnSection] = useState(null);
  const [branchModal, setBranchModal] = useState(null);
  const [inventoryModal, setInventoryModal] = useState(null);
  const [inventoryPage, setInventoryPage] = useState(1);
  const [branchInventoryPage, setBranchInventoryPage] = useState(1);
  const inventoryPageSize = 10;
  const showInventoryBranchColumn = inventoryFilter === "all";
  const inventoryGridClass = showInventoryBranchColumn
    ? "grid min-w-[1380px] grid-cols-[72px_90px_1.2fr_160px_140px_110px_120px_1.3fr_132px]"
    : "grid min-w-[1060px] grid-cols-[72px_90px_1.5fr_160px_140px_110px_120px_132px]";
  const sortedInventoryItems = [...inventoryItems].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }),
  );
  const inventoryTotalPages = Math.max(Math.ceil(sortedInventoryItems.length / inventoryPageSize), 1);
  const currentInventoryPage = Math.min(inventoryPage, inventoryTotalPages);
  const pagedInventoryItems = sortedInventoryItems.slice(
    (currentInventoryPage - 1) * inventoryPageSize,
    currentInventoryPage * inventoryPageSize,
  );
  const [branchInventoryLowOnly, setBranchInventoryLowOnly] = useState(false);
  const inventoryLowStockThreshold = auth.user.lowStockThreshold ?? 3;
  const [thresholdInput, setThresholdInput] = useState(() => String(auth.user.lowStockThreshold ?? 3));
  const [branchEdits, setBranchEdits] = useState({});
  const [savingBranchId, setSavingBranchId] = useState(null);
  const branchLowStockItems = branchInventoryItems.filter(
    (item) => getBranchInventoryStock(item) <= inventoryLowStockThreshold,
  );
  const visibleBranchInventoryItems = (branchInventoryLowOnly ? branchLowStockItems : branchInventoryItems)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
  const branchInventoryTotalPages = Math.max(Math.ceil(visibleBranchInventoryItems.length / 10), 1);
  const currentBranchInventoryPage = Math.min(branchInventoryPage, branchInventoryTotalPages);
  const pagedBranchInventoryItems = visibleBranchInventoryItems.slice(
    (currentBranchInventoryPage - 1) * 10,
    currentBranchInventoryPage * 10,
  );
  const [dashboardRange, setDashboardRange] = useState(() => ({
    from: getTodayDateInputValue(),
    to: getTodayDateInputValue(),
  }));
  const [dashboardData, setDashboardData] = useState(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardMessage, setDashboardMessage] = useState("");
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [businessCodeVisible, setBusinessCodeVisible] = useState(false);
  const [branchCodeVisible, setBranchCodeVisible] = useState(false);
  const [savingImage, setSavingImage] = useState(null);
  const [cropRequest, setCropRequest] = useState(null);
  const [settingsTab, setSettingsTab] = useState("Account");
  const [savingForm, setSavingForm] = useState(null);
  const [accountForm, setAccountForm] = useState(() => getAccountFormValues(auth.user));
  const [businessForm, setBusinessForm] = useState(() => ({
    businessName: auth.user.businessName || "",
    password: "",
  }));
  const [settingsCodeVisible, setSettingsCodeVisible] = useState(false);
  const [passwordForm, setPasswordForm] = useState(emptyPasswordForm);
  const accountFormChanged = Object.entries(getAccountFormValues(auth.user)).some(
    ([key, value]) => accountForm[key].trim() !== value,
  );
  const businessFormChanged = businessForm.businessName.trim() !== (auth.user.businessName || "");
  const [branchRecordTab, setBranchRecordTab] = useState("Branch details");
  const todayDate = getTodayDateInputValue();
  const [branchDateRange, setBranchDateRange] = useState({
    from: todayDate,
    to: todayDate,
  });
  const isDesktop = useIsDesktop();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const sidebarCompact = isDesktop && sidebarCollapsed;
  const sidebarWidthClass = isDesktop
    ? sidebarCompact
      ? "w-[72px]"
      : "w-[240px]"
    : `w-[260px] max-w-[85vw] ${mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"}`;
  const contentOffsetClass = isDesktop ? (sidebarCompact ? "pl-[72px]" : "pl-[240px]") : "pl-0";
  const permissions = auth.user.permissions ?? fullAccessPermissions;
  const settingsTabs = [
    { label: "Account", icon: faUser, allowed: permissions.accountSettings },
    { label: "Business", icon: faBuilding, allowed: permissions.businessSettings },
    { label: "Accounts", icon: faUserGroup, allowed: permissions.manageAccounts },
  ].filter((tab) => tab.allowed);
  const navigationItems = [
    { icon: faChartLine, label: "Dashboard" },
    { icon: faUser, label: "Profile" },
    { icon: faBoxesStacked, label: "Inventory" },
    { icon: faBuilding, label: "Branches" },
    { icon: faGear, label: "Settings" },
  ].filter((item) =>
    item.label === "Settings" ? settingsTabs.length > 0 : permissions.sections[sectionPermissionKeys[item.label]],
  );
  const branchRecordTabs = ["Branch details", "Sales", "Inventory"];

  const branchHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${auth.token}`,
  };

  async function requestBranchApi(path, options = {}) {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...options,
      headers: {
        ...branchHeaders,
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));

    if (response.status === 401) {
      removeSavedAuth();
      onLogout();
      navigate("/login", { replace: true });
      throw new Error("Your session expired. Please sign in again.");
    }

    if (!response.ok) {
      throw Object.assign(new Error(payload.message || "Unable to update branches."), {
        status: response.status,
        payload,
      });
    }

    return payload;
  }

  // Shows the cached copy of `path` right away (if any), then replaces it with fresh data.
  // Returns whether a cached copy was shown, so callers can skip their loading state.
  function loadCachedApi(path, apply, onError) {
    const cached = readApiCache(auth.user.id, path);

    if (cached) {
      apply(cached);
    }

    const request = requestBranchApi(path).then((payload) => {
      writeApiCache(auth.user.id, path, payload);
      apply(payload);
      return payload;
    });

    return { hadCache: Boolean(cached), request: onError ? request.catch(onError) : request };
  }

  async function loadBranches() {
    setBranchesMessage("");

    try {
      const { hadCache, request } = loadCachedApi("/branches", (payload) => setBranches(payload.branches));

      setBranchesLoading(!hadCache);
      await request;
    } catch (error) {
      setBranchesMessage(error.message);
    } finally {
      setBranchesLoading(false);
    }
  }

  useEffect(() => {
    if (navigationItems.length > 0 && !navigationItems.some((item) => item.label === activeSection)) {
      setActiveSection(navigationItems[0].label);
      setSelectedBranch(null);
    }

    if (settingsTabs.length > 0 && !settingsTabs.some((tab) => tab.label === settingsTab)) {
      setSettingsTab(settingsTabs[0].label);
    }
  }, [navigationItems.map((item) => item.label).join(), settingsTabs.map((tab) => tab.label).join()]);

  useEffect(() => {
    setInventoryPage(1);
  }, [inventoryFilter, inventorySearch]);

  useEffect(() => {
    setBranchInventoryPage(1);
  }, [selectedBranch?.id, branchInventoryLowOnly]);

  useEffect(() => {
    requestBranchApi("/me")
      .then((payload) => onUserUpdate(payload.user))
      .catch(() => {});
  }, []);

  const imageSettings = {
    profile: { endpoint: "/me/profile-image", label: "Profile picture", width: 400, height: 400 },
    banner: { endpoint: "/me/banner-image", label: "Banner image", width: 1600, height: 400 },
    logo: { endpoint: "/me/business-logo", label: "Business logo", width: 400, height: 400 },
  };

  function resetSettingsForms(user) {
    setAccountForm(getAccountFormValues(user));
    setBusinessForm({ businessName: user.businessName || "", password: "" });
    setSettingsCodeVisible(false);
    setThresholdInput(String(user.lowStockThreshold ?? 3));
    setBranchEdits({});
    setPasswordForm(emptyPasswordForm);
  }

  async function handleAccountSave(event) {
    event.preventDefault();
    setSavingForm("account");

    try {
      const payload = await requestBranchApi("/me/account", {
        method: "PUT",
        body: JSON.stringify(accountForm),
      });

      onUserUpdate(payload.user);
      setAccountForm(getAccountFormValues(payload.user));
      await Swal.fire("Account updated", "Your account details were saved.", "success");
    } catch (error) {
      await Swal.fire("Unable to update account", error.message, "error");
    } finally {
      setSavingForm(null);
    }
  }

  async function handleForgotPassword() {
    const confirmation = await Swal.fire({
      title: "Forgot your password?",
      html: `We will email a link to <b>${escapeHtml(auth.user.email || "")}</b> where you can set a new password.<br>The link expires in 30 minutes.`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Send link",
      confirmButtonColor: "#000000",
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    setSavingForm("forgot");

    try {
      const payload = await requestBranchApi("/me/password/forgot", { method: "POST" });

      await Swal.fire("Check your email", payload.message, "success");
    } catch (error) {
      await Swal.fire("Unable to send link", error.message, "error");
    } finally {
      setSavingForm(null);
    }
  }

  async function handlePasswordSave(event) {
    event.preventDefault();

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      await Swal.fire("Passwords do not match", "Re-type the new password in both fields.", "error");
      return;
    }

    setSavingForm("password");

    try {
      await requestBranchApi("/me/password", {
        method: "PUT",
        body: JSON.stringify(passwordForm),
      });

      setPasswordForm(emptyPasswordForm);
      await Swal.fire("Password updated", "Use your new password the next time you sign in.", "success");
    } catch (error) {
      await Swal.fire("Unable to update password", error.message, "error");
    } finally {
      setSavingForm(null);
    }
  }

  async function handleThresholdSave(event) {
    event.preventDefault();
    setSavingForm("threshold");

    try {
      const payload = await requestBranchApi("/me/business/settings", {
        method: "PUT",
        body: JSON.stringify({ lowStockThreshold: Number(thresholdInput) }),
      });

      onUserUpdate(payload.user);
      setThresholdInput(String(payload.user.lowStockThreshold));
      await Swal.fire(
        "Low stock level saved",
        `Items with ${payload.user.lowStockThreshold} or fewer left now count as low stock.`,
        "success",
      );
    } catch (error) {
      await Swal.fire("Unable to save low stock level", error.message, "error");
    } finally {
      setSavingForm(null);
    }
  }

  function getBranchEdit(branch) {
    return branchEdits[branch.id] ?? { name: branch.name, posCode: branch.posCode };
  }

  function updateBranchEdit(branch, field, value) {
    setBranchEdits((current) => ({
      ...current,
      [branch.id]: { ...(current[branch.id] ?? { name: branch.name, posCode: branch.posCode }), [field]: value },
    }));
  }

  async function handleBranchSettingsSave(event, branch) {
    event.preventDefault();

    const edit = getBranchEdit(branch);

    setSavingBranchId(branch.id);

    try {
      const payload = await requestBranchApi(`/branches/${branch.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: edit.name.trim(), details: branch.details, posCode: edit.posCode.trim() }),
      });

      setBranches((current) => current.map((item) => (item.id === branch.id ? payload.branch : item)));
      setBranchEdits((current) => {
        const next = { ...current };
        delete next[branch.id];
        return next;
      });
      await Swal.fire(
        "Branch saved",
        edit.posCode.trim() !== branch.posCode
          ? `${payload.branch.name} now signs in to the POS with its new code.`
          : `${payload.branch.name} was updated.`,
        "success",
      );
    } catch (error) {
      await Swal.fire("Unable to save branch", error.message, "error");
    } finally {
      setSavingBranchId(null);
    }
  }

  async function handleBusinessSave(event) {
    event.preventDefault();

    const confirmation = await Swal.fire({
      title: "Rename business?",
      html: `Your Business Code <b>${escapeHtml(auth.user.businessCode || "")}</b> will change to a new unique code.<br><br>POS sign-ins for every branch must use the new code.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Rename business",
      confirmButtonColor: "#000000",
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    setSavingForm("business");

    try {
      const payload = await requestBranchApi("/me/business", {
        method: "PUT",
        body: JSON.stringify(businessForm),
      });

      onUserUpdate(payload.user);
      setBusinessForm({ businessName: payload.user.businessName || "", password: "" });
      await Swal.fire({
        title: "Business renamed",
        html: `New Business Code: <b>${escapeHtml(payload.user.businessCode || "")}</b>`,
        icon: "success",
      });
    } catch (error) {
      await Swal.fire("Unable to rename business", error.message, "error");
    } finally {
      setSavingForm(null);
    }
  }

  async function handleImageUpdate(kind, file) {
    if (!file) {
      await saveImage(kind, null);
      return;
    }

    try {
      setCropRequest({ kind, source: await readImageFileAsDataUrl(file), mime: file.type });
    } catch (error) {
      await Swal.fire("Unable to open image", error.message, "error");
    }
  }

  async function handleCropConfirm(pixelCrop) {
    const { kind, source, mime } = cropRequest;
    const { width, height } = imageSettings[kind];

    setCropRequest(null);

    try {
      await saveImage(kind, await cropImageToDataUrl(source, pixelCrop, width, height, mime));
    } catch (error) {
      await Swal.fire("Unable to crop image", error.message, "error");
    }
  }

  async function saveImage(kind, image) {
    const { endpoint, label } = imageSettings[kind];

    setSavingImage(kind);

    try {
      const payload = await requestBranchApi(endpoint, {
        method: "PUT",
        body: JSON.stringify({ image }),
      });

      onUserUpdate(payload.user);
      await Swal.fire(image ? `${label} updated` : `${label} removed`, "", "success");
    } catch (error) {
      await Swal.fire(`Unable to update ${label.toLowerCase()}`, error.message, "error");
    } finally {
      setSavingImage(null);
    }
  }

  useEffect(() => {
    if (["Branches", "Inventory", "Profile", "Settings"].includes(activeSection)) {
      loadBranches();
    }
  }, [activeSection]);

  async function loadInventory() {
    setInventoryMessage("");

    try {
      const params = new URLSearchParams({
        branchId: inventoryFilter,
      });

      if (inventorySearch.trim()) {
        params.set("search", inventorySearch.trim());
      }

      const { hadCache, request } = loadCachedApi(`/inventory?${params.toString()}`, (payload) =>
        setInventoryItems(payload.inventoryItems),
      );

      setInventoryLoading(!hadCache);
      await request;
    } catch (error) {
      setInventoryMessage(error.message);
    } finally {
      setInventoryLoading(false);
    }
  }

  useEffect(() => {
    if (activeSection === "Inventory") {
      loadInventory();
    }
  }, [activeSection, inventoryFilter, inventorySearch]);

  // SKUs feed the inventory item form; Settings > Business manages them.
  useEffect(() => {
    if (activeSection === "Inventory") {
      loadCachedApi("/skus", (payload) => setSkus(payload.skus), (error) => setInventoryMessage(error.message));
    }
  }, [activeSection]);

  async function loadBranchInventory(branchId) {
    setBranchInventoryLoading(true);
    setBranchInventoryMessage("");

    try {
      const params = new URLSearchParams({
        branchId: String(branchId),
        from: branchDateRange.from,
        to: branchDateRange.to,
      });
      const payload = await requestBranchApi(`/inventory?${params.toString()}`);

      setBranchInventoryItems(payload.inventoryItems);
    } catch (error) {
      setBranchInventoryMessage(error.message);
    } finally {
      setBranchInventoryLoading(false);
    }
  }

  useEffect(() => {
    setBranchSalesPage(1);
  }, [selectedBranch?.id, branchDateRange.from, branchDateRange.to]);

  useEffect(() => {
    if (activeSection !== "Branches" || !selectedBranch || branchRecordTab !== "Sales") {
      return undefined;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setBranchSalesLoading(true);
      setBranchSalesMessage("");

      try {
        const params = new URLSearchParams({
          from: branchDateRange.from,
          to: branchDateRange.to,
          page: String(branchSalesPage),
          limit: "10",
          receipt: branchSalesSearch.receipt.trim(),
          item: branchSalesSearch.item.trim(),
          tz: getBrowserTimeZone(),
        });
        const payload = await requestBranchApi(`/branches/${selectedBranch.id}/sales?${params.toString()}`);

        if (!cancelled) {
          setBranchSales(payload);
        }
      } catch (error) {
        if (!cancelled) {
          setBranchSalesMessage(error.message);
        }
      } finally {
        if (!cancelled) {
          setBranchSalesLoading(false);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    activeSection,
    selectedBranch?.id,
    branchRecordTab,
    branchDateRange.from,
    branchDateRange.to,
    branchSalesPage,
    branchSalesSearch.receipt,
    branchSalesSearch.item,
  ]);

  useEffect(() => {
    if (activeSection !== "Dashboard") {
      return undefined;
    }

    let cancelled = false;

    setDashboardLoading(true);
    setDashboardMessage("");

    const params = new URLSearchParams({
      from: dashboardRange.from,
      to: dashboardRange.to,
      tz: getBrowserTimeZone(),
    });

    const { request } = loadCachedApi(`/dashboard?${params.toString()}`, (payload) => {
      if (!cancelled) {
        setDashboardData(payload);
      }
    });

    request
      .catch((error) => {
        if (!cancelled) {
          setDashboardMessage(error.message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDashboardLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeSection, dashboardRange.from, dashboardRange.to]);

  function handleOpenBranchSales(branch) {
    setActiveSection("Branches");
    handleOpenBranch(branch);
    setBranchReturnSection("Dashboard");
    setBranchRecordTab("Sales");
    setBranchDateRange(dashboardRange);
  }

  async function handleOpenReceipt(sale) {
    setBranchReceipt({ loading: true, receipt: null, error: "" });

    try {
      const payload = await requestBranchApi(`/branches/${selectedBranch.id}/sales/${sale.id}`);

      setBranchReceipt({ loading: false, receipt: payload.receipt, error: "" });
    } catch (error) {
      setBranchReceipt({ loading: false, receipt: null, error: error.message });
    }
  }

  useEffect(() => {
    if (activeSection === "Branches" && selectedBranch) {
      loadBranchInventory(selectedBranch.id);
    }
  }, [activeSection, selectedBranch?.id, branchDateRange.from, branchDateRange.to]);

  useEffect(() => {
    if (isDesktop) {
      setMobileSidebarOpen(false);
    }
  }, [isDesktop]);

  useEffect(() => {
    if (!mobileSidebarOpen) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setMobileSidebarOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileSidebarOpen]);

  function handleSectionChange(section) {
    setActiveSection(section);
    setMobileSidebarOpen(false);
    setBranchReturnSection(null);

    if (section === "Settings") {
      resetSettingsForms(auth.user);
    }

    if (section === "Branches") {
      setSelectedBranch(null);
      setBranchRecordTab("Branch details");
      return;
    }

    if (section === "Inventory") {
      setInventoryFilter("all");
    }

    setSelectedBranch(null);
  }

  function handleOpenBranch(branch) {
    setSelectedBranch(branch);
    setBranchCodeVisible(false);
    setBranchReturnSection(null);
    setBranchInventoryLowOnly(false);
    setBranchSales(null);
    setBranchSalesSearch({ receipt: "", item: "" });
    setBranchInventoryItems([]);
    setBranchInventoryMessage("");
    setBranchRecordTab("Branch details");
    setBranchDateRange({
      from: getTodayDateInputValue(),
      to: getTodayDateInputValue(),
    });
  }

  function handleAddBranch() {
    setBranchModal({ mode: "add", branch: null });
  }

  function handleViewBranch(branch) {
    setBranchModal({ mode: "view", branch });
  }

  function handleEditBranch(branch) {
    setBranchModal({ mode: "edit", branch });
  }

  async function handleBranchModalSave(values) {
    const { mode, branch } = branchModal;

    if (mode === "add") {
      const payload = await requestBranchApi("/branches", {
        method: "POST",
        body: JSON.stringify(values),
      });

      setBranches((current) => [...current, payload.branch]);
      setBranchModal(null);
      await Swal.fire("Branch added", `${payload.branch.name} was added.`, "success");
      return;
    }

    const payload = await requestBranchApi(`/branches/${branch.id}`, {
      method: "PATCH",
      body: JSON.stringify(values),
    });

    setBranches((current) => current.map((item) => (item.id === branch.id ? payload.branch : item)));
    setSelectedBranch((current) => (current?.id === branch.id ? payload.branch : current));
    setBranchModal(null);
    await Swal.fire("Branch updated", "The branch details were saved.", "success");
  }

  async function handleBranchModalToggle() {
    const branch = branchModal.branch;

    if (await handleToggleBranch(branch)) {
      setBranchModal(null);
    }
  }

  async function handleBranchModalDelete() {
    if (await handleDeleteBranch(branchModal.branch)) {
      setBranchModal(null);
    }
  }

  async function handleToggleBranch(branch) {
    try {
      const payload = await requestBranchApi(`/branches/${branch.id}/disable`, {
        method: "PATCH",
        body: JSON.stringify({ isDisabled: !branch.isDisabled }),
      });
      setBranches((current) =>
        current.map((item) => (item.id === branch.id ? payload.branch : item)),
      );
      setSelectedBranch((current) => (current?.id === branch.id ? payload.branch : current));
      return true;
    } catch (error) {
      await Swal.fire("Unable to update branch", error.message, "error");
      return false;
    }
  }

  async function handleSortBranch(branch, direction) {
    try {
      const payload = await requestBranchApi(`/branches/${branch.id}/sort`, {
        method: "PATCH",
        body: JSON.stringify({ direction }),
      });
      setBranches(payload.branches);
    } catch (error) {
      await Swal.fire("Unable to sort branches", error.message, "error");
    }
  }

  async function handleDeleteBranch(branch) {
    const result = await Swal.fire({
      title: "Remove branch forever?",
      html: `This removes <b>${escapeHtml(branch.name)}</b> forever.<br>Enter its POS code to confirm.`,
      icon: "warning",
      input: "password",
      inputPlaceholder: "POS code of this branch",
      inputAttributes: { autocomplete: "off", autocapitalize: "off" },
      showCancelButton: true,
      confirmButtonText: "Delete forever",
      confirmButtonColor: "#dc2626",
      showLoaderOnConfirm: true,
      allowOutsideClick: () => !Swal.isLoading(),
      preConfirm: async (posCode) => {
        if (!posCode?.trim()) {
          Swal.showValidationMessage("Enter the POS code first.");
          return false;
        }

        try {
          await requestBranchApi(`/branches/${branch.id}`, {
            method: "DELETE",
            body: JSON.stringify({ posCode: posCode.trim() }),
          });
          return true;
        } catch (error) {
          Swal.showValidationMessage(error.message);
          return false;
        }
      },
    });

    if (!result.isConfirmed) {
      return false;
    }

    try {
      setBranches((current) => current.filter((item) => item.id !== branch.id));
      setSelectedBranch((current) => (current?.id === branch.id ? null : current));
      await Swal.fire("Branch removed", "That branch was removed forever.", "success");
      return true;
    } catch (error) {
      await Swal.fire("Unable to remove branch", error.message, "error");
      return false;
    }
  }

  async function handleAddInventoryItem() {
    if (branches.length === 0) {
      await Swal.fire("No branches yet", "Add a branch before adding inventory items.", "info");
      return;
    }

    setInventoryModal({ type: "add", item: null });
  }

  function handleViewInventoryImage(item) {
    setInventoryModal({ type: "image", item });
  }

  function handleEditInventoryItem(item) {
    setInventoryModal({ type: "edit", item });
  }

  async function handleInventoryStock(item) {
    if (inventoryFilter !== "all" && !branches.some((branch) => String(branch.id) === String(inventoryFilter))) {
      await Swal.fire("Branch not found", "Select a branch before changing stock.", "info");
      return;
    }

    setInventoryModal({ type: "stock", item });
  }

  function handleInventoryHistory(item) {
    setInventoryModal({ type: "history", item });
  }

  async function saveInventoryItem(values) {
    const { type, item } = inventoryModal;

    await requestBranchApi(type === "add" ? "/inventory" : `/inventory/${item.id}`, {
      method: type === "add" ? "POST" : "PATCH",
      body: JSON.stringify(values),
    });
    setInventoryModal(null);
    await loadInventory();
    await Swal.fire(
      type === "add" ? "Inventory item added" : "Inventory item updated",
      type === "add" ? "The item was added to the selected branches." : "The item details were saved.",
      "success",
    );
  }

  async function deleteInventoryItem() {
    const { item } = inventoryModal;
    const confirmation = await Swal.fire({
      title: "Delete inventory item?",
      html: `This removes <b>${escapeHtml(item.name)}</b> and its stock from every branch forever.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Delete forever",
      confirmButtonColor: "#dc2626",
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    try {
      await requestBranchApi(`/inventory/${item.id}`, { method: "DELETE" });
      setInventoryModal(null);
      await loadInventory();
      await Swal.fire("Inventory item removed", "That item was removed forever.", "success");
    } catch (error) {
      await Swal.fire("Unable to remove item", error.message, "error");
    }
  }

  async function saveInventoryStock(values) {
    await requestBranchApi(`/inventory/${inventoryModal.item.id}/stock`, {
      method: "POST",
      body: JSON.stringify(values),
    });
    setInventoryModal(null);
    await loadInventory();
    await Swal.fire("Inventory stock updated", "The item stock was saved.", "success");
  }

  function getInventoryDisplayStocks(item) {
    if (inventoryFilter === "all") {
      return item.stocks;
    }

    if (item.branchStock !== undefined && item.branchStock !== null) {
      return item.branchStock;
    }

    const selectedBranch = item.branches.find((branch) => String(branch.id) === String(inventoryFilter));
    return selectedBranch?.stocks ?? 0;
  }

  return (
    <main className={`min-h-screen bg-[#f6f8f5] transition-[padding] duration-300 ${contentOffsetClass}`}>
      {!isDesktop && mobileSidebarOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]"
          onClick={() => setMobileSidebarOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      <aside
        id="dashboard-sidebar"
        className={`fixed inset-y-0 left-0 z-50 flex h-dvh flex-col bg-[#0b0f0b] px-3 pb-4 pt-5 text-white shadow-[8px_0_40px_rgba(0,0,0,0.18)] duration-300 ${
          isDesktop ? "transition-[width]" : "transition-transform"
        } ${sidebarWidthClass}`}
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-20 -top-20 h-56 w-56 rounded-full bg-brand/15 blur-3xl" />
          <div className="absolute -bottom-24 -right-24 h-56 w-56 rounded-full bg-green-700/20 blur-3xl" />
        </div>

        <div className={`relative flex items-center gap-2.5 pb-5 ${sidebarCompact ? "justify-center" : "px-1"}`}>
          <LogoMark className="h-10 w-10 shrink-0 drop-shadow-[0_4px_12px_rgba(99,224,80,0.35)]" />
          {!sidebarCompact ? (
            <div className="min-w-0 flex-1">
              <p className="text-lg font-bold leading-none tracking-tight">CowFlo</p>
              <p className="mt-1 truncate text-[11px] font-medium text-brand">Keep Moo-ving. No Bull.</p>
            </div>
          ) : null}
          {!isDesktop ? (
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(false)}
              aria-label="Close menu"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white/60 transition hover:bg-white/10 hover:text-white"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          ) : null}
        </div>

        <div className="relative mb-4 h-px bg-white/10" />

        {isDesktop ? (
          <button
            type="button"
            onClick={() => setSidebarCollapsed((current) => !current)}
            aria-expanded={!sidebarCollapsed}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="absolute -right-4 top-1/2 z-10 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border-2 border-[#f6f8f5] bg-brand text-xs text-black shadow-lg transition hover:brightness-110"
          >
            <FontAwesomeIcon icon={sidebarCollapsed ? faChevronRight : faChevronLeft} />
          </button>
        ) : null}

        {!sidebarCompact ? (
          <p className="relative mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/35">Menu</p>
        ) : null}
        <nav className="relative grid gap-1.5">
          {navigationItems.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => handleSectionChange(item.label)}
              title={item.label}
              className={`flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition ${
                sidebarCompact ? "justify-center" : "justify-start"
              } ${
                activeSection === item.label
                  ? "bg-brand font-semibold text-black shadow-[0_6px_20px_rgba(99,224,80,0.25)]"
                  : "text-white/65 hover:bg-white/[0.07] hover:text-white"
              }`}
            >
              <span className="flex h-5 w-5 items-center justify-center">
                <FontAwesomeIcon icon={item.icon} />
              </span>
              {!sidebarCompact ? <span>{item.label}</span> : null}
            </button>
          ))}
        </nav>

        <button
          type="button"
          onClick={onLogout}
          title="Logout"
          className={`relative mt-auto flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-red-400 transition hover:bg-red-500/10 hover:text-red-300 ${
            sidebarCompact ? "justify-center" : "justify-start"
          }`}
        >
          <span className="flex h-5 w-5 items-center justify-center">
            <FontAwesomeIcon icon={faRightFromBracket} />
          </span>
          {!sidebarCompact ? <span>Logout</span> : null}
        </button>
      </aside>

      <div className="flex h-dvh flex-col">
        <header className="relative z-30 shrink-0 border-b border-black/10 bg-white/85 backdrop-blur">
          <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              {!isDesktop ? (
                <button
                  type="button"
                  onClick={() => setMobileSidebarOpen((current) => !current)}
                  aria-expanded={mobileSidebarOpen}
                  aria-controls="dashboard-sidebar"
                  aria-label={mobileSidebarOpen ? "Close menu" : "Open menu"}
                  title={mobileSidebarOpen ? "Close menu" : "Open menu"}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg text-black transition hover:bg-brand/15"
                >
                  <FontAwesomeIcon icon={mobileSidebarOpen ? faXmark : faBars} />
                </button>
              ) : null}
              <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#0b0f0b] text-xs font-bold text-brand ring-1 ring-black/5">
                {auth.user.businessLogo ? (
                  <img src={auth.user.businessLogo} alt="Business logo" className="h-full w-full object-cover" />
                ) : (
                  getInitials(businessName)
                )}
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold leading-tight text-black sm:text-lg">{businessName}</h1>
                <p className="truncate text-xs text-black/50">
                  Welcome back, <span className="font-medium text-green-700">{username}</span>
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => navigationItems.some((item) => item.label === "Profile") && handleSectionChange("Profile")}
              title="Profile"
              className="flex shrink-0 items-center gap-3 rounded-full border border-black/[0.06] bg-white py-1 pl-1 pr-1 shadow-sm transition hover:border-brand/40 hover:shadow-md sm:pr-4"
            >
              <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-brand/20 text-xs font-semibold text-black">
                <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full">
                  {auth.user.profileImage ? (
                    <img src={auth.user.profileImage} alt="Profile" className="h-full w-full object-cover" />
                  ) : (
                    getInitials(auth.user.name)
                  )}
                </span>
                <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-brand" />
              </span>
              <span className="hidden min-w-0 text-left sm:block">
                <span className="block max-w-[160px] truncate text-sm font-semibold leading-tight text-black">
                  {auth.user.name}
                </span>
                <span className="block text-xs capitalize leading-tight text-black/50">{auth.user.role || "owner"}</span>
              </span>
            </button>
          </div>
        </header>

      <section className="main-container min-h-0 w-full flex-1 overflow-auto bg-white p-4 sm:p-6">
        {navigationItems.length === 0 ? (
          <div className="mx-auto mt-10 max-w-md rounded-[28px] border border-dashed border-black/15 p-8 text-center">
            <FontAwesomeIcon icon={faLock} className="text-2xl text-black/30" />
            <h3 className="mt-3 text-lg font-semibold text-black">No access yet</h3>
            <p className="mt-2 text-sm text-black/55">
              Your account is connected to {businessName}, but the owner has not given you access to any page yet.
            </p>
          </div>
        ) : null}

        {navigationItems.length > 0 && activeSection !== "Profile" && activeSection !== "Dashboard" ? (
          <nav aria-label="Breadcrumb" className="-mt-2.5 mb-4 sm:-mt-4">
            <ol className="flex flex-wrap items-center gap-1.5 text-sm text-black/45">
              {(selectedBranch
                ? [
                    branchReturnSection
                      ? { label: branchReturnSection, onClick: () => handleSectionChange(branchReturnSection) }
                      : null,
                    { label: "Branches", onClick: () => handleSectionChange("Branches") },
                    { label: selectedBranch.name },
                  ]
                : [{ label: activeSection }]
              )
                .filter(Boolean)
                .map((crumb, index, crumbs) => (
                  <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
                    {index > 0 ? (
                      <FontAwesomeIcon icon={faChevronRight} className="text-[10px] text-black/25" aria-hidden="true" />
                    ) : null}
                    {crumb.onClick && index < crumbs.length - 1 ? (
                      <button type="button" onClick={crumb.onClick} className="transition hover:text-black">
                        {crumb.label}
                      </button>
                    ) : (
                      <span aria-current="page" className="truncate font-medium text-black/70">
                        {crumb.label}
                      </span>
                    )}
                  </li>
                ))}
            </ol>
          </nav>
        ) : null}

        {activeSection === "Dashboard" ? (
          <div className="space-y-8">
            <section className="relative overflow-hidden rounded-[28px] bg-black p-5 text-white shadow-panel sm:p-8">
              <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-brand/30 blur-3xl" />
              <div className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-brand/10 blur-3xl" />

              <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
                <div className="flex min-w-0 items-center gap-4 sm:gap-5">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white text-2xl text-black shadow-panel sm:h-20 sm:w-20">
                    {(dashboardData?.business.logo ?? auth.user.businessLogo) ? (
                      <img
                        src={dashboardData?.business.logo ?? auth.user.businessLogo}
                        alt="Business logo"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <FontAwesomeIcon icon={faBuilding} />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/55">
                      Welcome back, {auth.user.firstName || auth.user.name}
                    </p>
                    <h1 className="mt-1 truncate text-2xl font-bold sm:text-4xl">
                      {dashboardData?.business.name || businessName}
                    </h1>
                    <p className="mt-1 flex items-center gap-2 text-sm text-white/60">
                      <FontAwesomeIcon icon={faCalendarDays} />
                      {dashboardRange.from === dashboardRange.to
                        ? formatDateInputLabel(dashboardRange.from)
                        : `${formatDateInputLabel(dashboardRange.from)} – ${formatDateInputLabel(dashboardRange.to)}`}
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {getDashboardRangePresets().map((preset) => {
                      const active = preset.from === dashboardRange.from && preset.to === dashboardRange.to;

                      return (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => setDashboardRange({ from: preset.from, to: preset.to })}
                          className={`h-9 rounded-full px-4 text-sm font-semibold transition ${
                            active ? "bg-brand text-black" : "bg-white/10 text-white/80 hover:bg-white/20"
                          }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:flex">
                    {[
                      ["from", "From"],
                      ["to", "To"],
                    ].map(([key, label]) => (
                      <label key={key} className="grid gap-1 text-xs font-semibold uppercase text-white/50">
                        {label}
                        <input
                          type="date"
                          value={dashboardRange[key]}
                          max={key === "from" ? dashboardRange.to : undefined}
                          min={key === "to" ? dashboardRange.from : undefined}
                          onChange={(event) => {
                            const value = event.target.value;

                            if (value) {
                              setDashboardRange((current) => ({ ...current, [key]: value }));
                            }
                          }}
                          className="h-10 w-full rounded-xl border border-white/15 bg-white/10 px-3 text-sm font-medium text-white outline-none [color-scheme:dark] focus:border-brand focus:ring-2 focus:ring-brand/30"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {dashboardMessage ? <p className="text-sm text-red-600">{dashboardMessage}</p> : null}

            <section className={`space-y-4 transition ${dashboardLoading && dashboardData ? "opacity-60" : ""}`}>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-black">Overall</h2>
                  <p className="text-sm text-black/50">All branches combined.</p>
                </div>
                {dashboardLoading ? <span className="text-sm text-black/45">Updating...</span> : null}
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                <DashboardStatCard
                  tone="dark"
                  icon={faCoins}
                  label="Sales"
                  value={formatMoney(dashboardData?.overall.netSales)}
                  sub="Refunds not included"
                />
                <DashboardStatCard
                  icon={faArrowDown}
                  label="Refunds"
                  value={formatMoney(dashboardData?.overall.refunds)}
                  sub={`${(dashboardData?.overall.itemsRefunded ?? 0).toLocaleString()} items returned`}
                />
                <DashboardStatCard
                  icon={faReceipt}
                  label="Sold"
                  value={(dashboardData?.overall.transactions ?? 0).toLocaleString()}
                  sub={dashboardData?.overall.transactions === 1 ? "transaction" : "transactions"}
                />
                <DashboardStatCard
                  icon={faBoxesStacked}
                  label="Items sold"
                  value={(dashboardData?.overall.netItemsSold ?? 0).toLocaleString()}
                  sub="Returned items not included"
                />
                <DashboardStatCard
                  tone={dashboardData?.overall.lowStockItems.length ? "warning" : "default"}
                  icon={faTriangleExclamation}
                  label="Low stock"
                  value={(dashboardData?.overall.lowStockItems.length ?? 0).toLocaleString()}
                  sub={`items at ${dashboardData?.lowStockThreshold ?? 3} or below`}
                />
              </div>

            </section>

            <section className={`space-y-4 transition ${dashboardLoading && dashboardData ? "opacity-60" : ""}`}>
              <div>
                <h2 className="text-xl font-semibold text-black">Per branch</h2>
                <p className="text-sm text-black/50">Tap a branch to open its sales records.</p>
              </div>

              {dashboardData && dashboardData.branches.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-black/15 p-8 text-center text-sm text-black/55">
                  No branches yet. Add one in Branches.
                </div>
              ) : null}

              <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {dashboardData?.branches.map((branch) => (
                  <button
                    key={branch.id}
                    type="button"
                    onClick={() => handleOpenBranchSales(branch)}
                    className="group rounded-[24px] border border-black/8 bg-white p-5 text-left shadow-panel transition hover:-translate-y-0.5 hover:border-brand/60"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/15 text-black">
                          <FontAwesomeIcon icon={faBuilding} />
                        </span>
                        <div className="min-w-0">
                          <h3 className="truncate text-base font-semibold text-black">{branch.name}</h3>
                          <p className={`text-xs font-semibold ${branch.isDisabled ? "text-black/40" : "text-green-700"}`}>
                            {branch.isDisabled ? "Disabled" : "Active"}
                          </p>
                        </div>
                      </div>
                      <FontAwesomeIcon
                        icon={faChevronRight}
                        className="text-sm text-black/30 transition group-hover:translate-x-0.5 group-hover:text-black"
                      />
                    </div>

                    <div className="mt-4 rounded-2xl bg-black px-4 py-3 text-white">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/55">Sales</p>
                      <p className="mt-1 truncate text-2xl font-bold">{formatMoney(branch.netSales)}</p>
                      <p className="truncate text-xs text-white/55">
                        Refunds{" "}
                        <span className={branch.refunds > 0 ? "font-semibold text-red-300" : ""}>
                          {formatMoney(branch.refunds)}
                        </span>
                      </p>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {[
                        ["Sold", branch.transactions],
                        ["Items sold", branch.netItemsSold],
                        ["Low stock", branch.lowStockItems.length],
                      ].map(([label, value]) => (
                        <div
                          key={label}
                          className={`rounded-xl px-3 py-2 ${
                            label === "Low stock" && value > 0 ? "bg-amber-50 text-amber-800" : "bg-black/[0.03]"
                          }`}
                        >
                          <p className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] opacity-60">
                            {label}
                          </p>
                          <p className="text-lg font-bold">{value.toLocaleString()}</p>
                        </div>
                      ))}
                    </div>

                  </button>
                ))}
              </div>
            </section>
          </div>
        ) : null}

        {activeSection === "Profile" ? (
          <div className="-m-4 space-y-6 pb-4 sm:-m-6 sm:pb-6">
            <section className="border-b border-black/8 bg-white">
              <div className="h-36 overflow-hidden bg-gradient-to-r from-black via-black/85 to-brand/70 sm:h-56">
                {auth.user.bannerImage ? (
                  <img src={auth.user.bannerImage} alt="Profile banner" className="h-full w-full object-cover" />
                ) : null}
              </div>
              <div className="flex flex-col gap-4 px-4 pb-6 sm:flex-row sm:items-end sm:justify-between sm:px-6">
                <div className="flex min-w-0 items-end gap-4 sm:gap-5">
                  <div className="-mt-12 flex h-24 w-24 shrink-0 sm:-mt-16 sm:h-32 sm:w-32 items-center justify-center overflow-hidden rounded-full border-4 border-white bg-brand/20 text-3xl font-semibold text-black shadow-panel">
                    {auth.user.profileImage ? (
                      <img src={auth.user.profileImage} alt="Profile" className="h-full w-full object-cover" />
                    ) : (
                      getInitials(auth.user.name)
                    )}
                  </div>
                  <div className="min-w-0 pb-1">
                    <h3 className="truncate text-2xl font-bold text-black sm:text-3xl">{auth.user.name}</h3>
                    <p className="truncate text-sm text-black/55">@{username}</p>
                  </div>
                </div>
                {settingsTabs.length > 0 ? (
                <button
                  type="button"
                  onClick={() => handleSectionChange("Settings")}
                  className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-xl border border-black/10 px-4 text-sm font-semibold text-black transition hover:bg-brand/15 sm:self-auto"
                >
                  <FontAwesomeIcon icon={faCamera} />
                  Edit in Settings
                </button>
                ) : null}
              </div>
            </section>

            <div className="grid items-start gap-6 px-4 sm:px-6 xl:grid-cols-2">
              <section className="rounded-[28px] border border-black/8 bg-white p-6 shadow-panel">
                <div className="mb-5 flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/15 text-black">
                    <FontAwesomeIcon icon={faUser} />
                  </span>
                  <div>
                    <h3 className="text-lg font-semibold text-black">Account</h3>
                    <p className="text-sm text-black/50">Your personal sign-in details.</p>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <ProfileField label="Account Name" icon={faUser} value={auth.user.name} />
                  <ProfileField label="Account Username" icon={faCircleCheck} value={username} />
                  <div className="md:col-span-2">
                    <ProfileField label="Account Email" icon={faEnvelope} value={auth.user.email} />
                  </div>
                </div>
              </section>

              <section className="rounded-[28px] border border-black/8 bg-white p-6 shadow-panel">
                <div className="mb-5 flex items-center gap-3">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-black/8 bg-brand/15 text-black">
                    {auth.user.businessLogo ? (
                      <img src={auth.user.businessLogo} alt="Business logo" className="h-full w-full object-cover" />
                    ) : (
                      <FontAwesomeIcon icon={faBuilding} />
                    )}
                  </span>
                  <div>
                    <h3 className="text-lg font-semibold text-black">Business</h3>
                    <p className="text-sm text-black/50">The business this account manages.</p>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <ProfileField label="Business Name" icon={faBuilding} value={businessName} />
                  <ProfileField
                    label="Business Code"
                    icon={faKey}
                    value={
                      auth.user.businessCode
                        ? businessCodeVisible
                          ? auth.user.businessCode
                          : "•".repeat(auth.user.businessCode.length)
                        : "-"
                    }
                    action={
                      auth.user.businessCode ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.preventDefault();
                            setBusinessCodeVisible((current) => !current);
                          }}
                          aria-label={businessCodeVisible ? "Hide business code" : "Show business code"}
                          title={businessCodeVisible ? "Hide business code" : "Show business code"}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-black/55 transition hover:bg-brand/15 hover:text-black"
                        >
                          <FontAwesomeIcon icon={businessCodeVisible ? faEyeSlash : faEye} />
                        </button>
                      ) : null
                    }
                  />
                </div>

                <div className="mt-6">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-black/45">Branches</p>
                  {branchesLoading ? (
                    <p className="mt-3 text-sm text-black/45">Loading branches...</p>
                  ) : branchesMessage ? (
                    <p className="mt-3 text-sm text-red-600">{branchesMessage}</p>
                  ) : branches.length === 0 ? (
                    <p className="mt-3 text-sm text-black/45">No branches yet.</p>
                  ) : (
                    <ul className="mt-3 grid gap-2">
                      {branches.map((branch) => (
                        <li key={branch.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setActiveSection("Branches");
                              handleOpenBranch(branch);
                              setBranchReturnSection("Profile");
                            }}
                            className="flex w-full items-center gap-3 rounded-xl border border-black/8 bg-white px-4 py-3 text-left text-sm font-medium text-black transition hover:bg-brand/15"
                          >
                            <FontAwesomeIcon icon={faBuilding} className="text-black/45" />
                            <span className="flex-1 truncate">{branch.name}</span>
                            {branch.isDisabled ? (
                              <span className="text-xs text-black/45">Disabled</span>
                            ) : null}
                            <FontAwesomeIcon icon={faChevronRight} className="text-xs text-black/35" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            </div>
          </div>
        ) : null}

        {activeSection === "Inventory" ? (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="grid gap-2 text-sm font-semibold text-black sm:w-52 lg:w-60">
                  Inventory view
                  <select
                    value={inventoryFilter}
                    onChange={(event) => setInventoryFilter(event.target.value)}
                    className="h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm font-medium text-black outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                  >
                    <option value="all">All</option>
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid min-w-0 gap-2 text-sm font-semibold text-black sm:max-w-sm sm:flex-1">
                  Search item, ID, SKU or category
                  <span className="relative block">
                    <FontAwesomeIcon
                      icon={faMagnifyingGlass}
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black/35"
                    />
                    <input
                      type="search"
                      value={inventorySearch}
                      onChange={(event) => setInventorySearch(event.target.value)}
                      placeholder="Item, ID, SKU or category"
                      className="h-11 w-full rounded-xl border border-black/10 bg-white pl-10 pr-3 text-sm font-medium text-black outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                    />
                  </span>
                </label>

              {inventoryFilter === "all" ? (
                <button
                  type="button"
                  onClick={handleAddInventoryItem}
                  className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-brand px-4 sm:ml-auto text-sm font-semibold text-black transition hover:brightness-95"
                >
                  <FontAwesomeIcon icon={faPlus} />
                  Add item
                </button>
              ) : null}
            </div>

            {inventoryMessage ? <p className="text-sm text-red-600">{inventoryMessage}</p> : null}

            <div className="overflow-x-auto rounded-2xl border border-black/8">
              <div className={`${inventoryGridClass} gap-3 bg-black px-4 py-3 text-xs font-semibold uppercase text-white/65`}>
                <span>ID</span>
                <span>Image</span>
                <span>Item name</span>
                <span>SKU</span>
                <span>Category</span>
                <span>Stocks</span>
                <span>Price</span>
                {showInventoryBranchColumn ? <span>Branches</span> : null}
                <span>Actions</span>
              </div>

              {inventoryLoading || branchesLoading ? (
                <div className="px-4 py-8 text-center text-sm text-black/55">Loading inventory...</div>
              ) : null}

              {!inventoryLoading && !branchesLoading && inventoryItems.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <h3 className="text-lg font-semibold text-black">No inventory items yet</h3>
                  <p className="mt-2 text-sm text-black/55">
                    {inventoryFilter === "all"
                      ? "Add your first item and choose which branches should receive it."
                      : "No items are assigned to this branch yet."}
                  </p>
                </div>
              ) : null}

              {!inventoryLoading && !branchesLoading
                ? pagedInventoryItems.map((item, index) => {
                    const stockTone = getStockRowTone(getInventoryDisplayStocks(item), inventoryLowStockThreshold);

                    return (
                    <article
                      key={item.id}
                      className={`${inventoryGridClass} items-center gap-3 px-4 py-4 text-sm transition ${stockTone.row} ${
                        index > 0 ? "border-t border-black/8" : ""
                      }`}
                    >
                      <p className="font-semibold text-black/70">#{item.id}</p>
                      {item.imageUrl ? (
                        <button
                          type="button"
                          onClick={() => handleViewInventoryImage(item)}
                          className="inline-flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl border border-black/8 bg-black/3 transition hover:ring-2 hover:ring-brand/30"
                        >
                          <img
                            src={getInventoryImageSrc(item)}
            loading="lazy"
                            alt={item.imageName || item.name}
                            className="h-full w-full object-cover"
                          />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleViewInventoryImage(item)}
                          className="inline-flex h-14 w-14 items-center justify-center rounded-xl border border-dashed border-black/15 bg-black/3 text-black/35"
                          title="No image"
                        >
                          <FontAwesomeIcon icon={faImage} />
                        </button>
                      )}
                      <p className="truncate font-semibold text-black">{item.name}</p>
                      <p className="truncate text-black/70" title={formatSkuLabel(item)}>
                        {formatSkuLabel(item) || "-"}
                      </p>
                      <p className="truncate text-black/70" title={item.categoryName || ""}>
                        {item.categoryName || "-"}
                      </p>
                      <p className={stockTone.text}>{getInventoryDisplayStocks(item)}</p>
                      <p className="font-medium text-black/70">{formatMoney(item.price)}</p>
                      {showInventoryBranchColumn ? (
                        <p className="truncate text-black/60">
                          {item.branches
                            .map((branch) => `${branch.name} (${branch.stocks})`)
                            .join(", ") || "No branches"}
                        </p>
                      ) : null}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleEditInventoryItem(item)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-black/8 text-black transition hover:bg-black/5"
                          title="Edit item"
                        >
                          <FontAwesomeIcon icon={faPen} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleInventoryStock(item)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-black/8 text-black transition hover:bg-black/5"
                          title="Add stock"
                        >
                          <FontAwesomeIcon icon={faCirclePlus} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleInventoryHistory(item)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-black/8 text-black transition hover:bg-black/5"
                          title="Stock history"
                        >
                          <FontAwesomeIcon icon={faClockRotateLeft} />
                        </button>
                      </div>
                    </article>
                    );
                  })
                : null}
            </div>

            <Pagination
              page={currentInventoryPage}
              pageSize={inventoryPageSize}
              total={sortedInventoryItems.length}
              onChange={setInventoryPage}
            />
          </div>
        ) : null}

        {activeSection === "Branches" ? (
          selectedBranch ? (
            <div className="space-y-5">
              <div className="flex flex-col gap-4 border-b border-black/8 pb-5 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (branchReturnSection) {
                        handleSectionChange(branchReturnSection);
                        return;
                      }

                      setSelectedBranch(null);
                    }}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-black/8 px-3 text-sm font-semibold text-black transition hover:bg-black/5"
                  >
                    <FontAwesomeIcon icon={faArrowLeft} />
                    {branchReturnSection || "Branches"}
                  </button>

                  <div className="flex flex-wrap items-center gap-2">
                    {branchRecordTabs.map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setBranchRecordTab(tab)}
                        className={`inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition ${
                          branchRecordTab === tab
                            ? "bg-black text-white"
                            : "border border-black/8 text-black/65 hover:bg-black/5 hover:text-black"
                        }`}
                      >
                        {tab}
                        {tab === "Inventory" && branchLowStockItems.length > 0 ? (
                          <span
                            title={`${branchLowStockItems.length} low stock ${
                              branchLowStockItems.length === 1 ? "item" : "items"
                            }`}
                            className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-800 px-1.5 text-[11px] font-bold text-white"
                          >
                            {branchLowStockItems.length}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>

                {branchRecordTab !== "Branch details" ? (
                <div className="flex flex-wrap items-center gap-3">
                  <label className="grid gap-1 text-xs font-semibold uppercase text-black/45">
                    From
                    <input
                      type="date"
                      value={branchDateRange.from}
                      onChange={(event) =>
                        setBranchDateRange((current) => ({ ...current, from: event.target.value }))
                      }
                      className="h-10 rounded-xl border border-black/10 px-3 text-sm font-medium text-black outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold uppercase text-black/45">
                    To
                    <input
                      type="date"
                      value={branchDateRange.to}
                      onChange={(event) =>
                        setBranchDateRange((current) => ({ ...current, to: event.target.value }))
                      }
                      className="h-10 rounded-xl border border-black/10 px-3 text-sm font-medium text-black outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                    />
                  </label>
                </div>
                ) : null}
              </div>

              {branchRecordTab === "Branch details" ? (
                <div className="space-y-6">
                  <section className="rounded-[28px] border border-black/8 bg-white shadow-panel">
                    <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                      <div className="flex min-w-0 items-center gap-4">
                        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-black/8 bg-brand/15 text-2xl text-black sm:h-24 sm:w-24">
                          {auth.user.businessLogo ? (
                            <img src={auth.user.businessLogo} alt="Business logo" className="h-full w-full object-cover" />
                          ) : (
                            <FontAwesomeIcon icon={faBuilding} />
                          )}
                        </div>
                        <div className="min-w-0">
                          <h3 className="truncate text-2xl font-bold text-black">{selectedBranch.name}</h3>
                          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-black/55">
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                                selectedBranch.isDisabled ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"
                              }`}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${selectedBranch.isDisabled ? "bg-amber-500" : "bg-green-600"}`}
                              />
                              {selectedBranch.isDisabled ? "Disabled" : "Active"}
                            </span>
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleEditBranch(selectedBranch)}
                        className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-xl border border-black/10 px-4 text-sm font-semibold text-black transition hover:bg-brand/15 sm:self-auto"
                      >
                        <FontAwesomeIcon icon={faPen} />
                        Edit branch
                      </button>
                    </div>
                  </section>

                  <div className="grid items-start gap-6 xl:grid-cols-2">
                    <section className="rounded-[28px] border border-black/8 bg-white p-6 shadow-panel">
                      <div className="mb-5 flex items-center gap-3">
                        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/15 text-black">
                          <FontAwesomeIcon icon={faBuilding} />
                        </span>
                        <div>
                          <h3 className="text-lg font-semibold text-black">Branch</h3>
                          <p className="text-sm text-black/50">How this branch signs in to the POS.</p>
                        </div>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <ProfileField label="Branch Name" icon={faBuilding} value={selectedBranch.name} />
                        <ProfileField
                          label="Code for POS"
                          icon={faKey}
                          value={
                            branchCodeVisible ? selectedBranch.posCode : "•".repeat(selectedBranch.posCode?.length || 0)
                          }
                          action={
                            <button
                              type="button"
                              onClick={() => setBranchCodeVisible((current) => !current)}
                              aria-label={branchCodeVisible ? "Hide code for POS" : "Show code for POS"}
                              title={branchCodeVisible ? "Hide code for POS" : "Show code for POS"}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-black/55 transition hover:bg-brand/15 hover:text-black"
                            >
                              <FontAwesomeIcon icon={branchCodeVisible ? faEyeSlash : faEye} />
                            </button>
                          }
                        />
                        <ProfileField
                          label="Status"
                          icon={selectedBranch.isDisabled ? faLock : faCircleCheck}
                          value={selectedBranch.isDisabled ? "Disabled - POS sign-in is blocked" : "Active"}
                        />
                        <ProfileField
                          label="Added"
                          icon={faCalendarDays}
                          value={
                            selectedBranch.createdAt
                              ? new Date(selectedBranch.createdAt).toLocaleDateString(undefined, {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })
                              : "-"
                          }
                        />
                      </div>
                    </section>

                    <div className="grid gap-6">
                      <section className="rounded-[28px] border border-black/8 bg-white p-6 shadow-panel">
                        <div className="mb-4 flex items-center gap-3">
                          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/15 text-black">
                            <FontAwesomeIcon icon={faPen} />
                          </span>
                          <div>
                            <h3 className="text-lg font-semibold text-black">Details</h3>
                            <p className="text-sm text-black/50">Address, contact person, opening hours.</p>
                          </div>
                        </div>
                        <p className="whitespace-pre-line rounded-xl border border-black/10 bg-black/[0.02] px-4 py-3 text-sm leading-6 text-black/75">
                          {selectedBranch.details || <span className="text-black/40">No details yet.</span>}
                        </p>
                      </section>

                      <section className="rounded-[28px] border border-black/8 bg-white p-6 shadow-panel">
                        <div className="mb-4 flex items-center gap-3">
                          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/15 text-black">
                            <FontAwesomeIcon icon={faBoxesStacked} />
                          </span>
                          <div>
                            <h3 className="text-lg font-semibold text-black">Stock at a glance</h3>
                            <p className="text-sm text-black/50">Items assigned to this branch.</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              setBranchInventoryLowOnly(false);
                              setBranchRecordTab("Inventory");
                            }}
                            className="rounded-2xl border border-black/8 p-4 text-left transition hover:bg-brand/10"
                          >
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-black/45">Items</p>
                            <p className="mt-1 text-2xl font-bold text-black">
                              {branchInventoryLoading ? "…" : branchInventoryItems.length}
                            </p>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setBranchInventoryLowOnly(true);
                              setBranchRecordTab("Inventory");
                            }}
                            className={`rounded-2xl border p-4 text-left transition ${
                              branchLowStockItems.length > 0
                                ? "border-red-200 bg-red-50/60 hover:bg-red-50"
                                : "border-black/8 hover:bg-brand/10"
                            }`}
                          >
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-black/45">Low stock</p>
                            <p
                              className={`mt-1 text-2xl font-bold ${
                                branchLowStockItems.length > 0 ? "text-red-700" : "text-black"
                              }`}
                            >
                              {branchInventoryLoading ? "…" : branchLowStockItems.length}
                            </p>
                          </button>
                        </div>
                      </section>
                    </div>
                  </div>
                </div>
              ) : null}

              {branchRecordTab === "Sales" ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                    {[
                      {
                        label: "Total sales",
                        value: formatMoney(branchSales?.summary.netSales),
                        sub: "Refunds not included",
                        dark: true,
                      },
                      {
                        label: "Refunds",
                        value: formatMoney(branchSales?.summary.refunds),
                        sub: `${(branchSales?.summary.itemsRefunded ?? 0).toLocaleString()} items returned`,
                        red: (branchSales?.summary.refunds ?? 0) > 0,
                      },
                      {
                        label: "Transactions",
                        value: (branchSales?.summary.transactions ?? 0).toLocaleString(),
                      },
                      {
                        label: "Items sold",
                        value: (branchSales?.summary.netItemsSold ?? 0).toLocaleString(),
                        sub: "Returned items not included",
                      },
                    ].map((card) => (
                      <article
                        key={card.label}
                        className={`rounded-2xl border p-4 ${
                          card.dark ? "border-black bg-black text-white" : "border-black/8 bg-black/3"
                        }`}
                      >
                        <p className={`text-xs font-semibold uppercase tracking-[0.12em] ${card.dark ? "text-white/60" : "text-black/45"}`}>
                          {card.label}
                        </p>
                        <p className={`mt-2 truncate text-xl font-bold ${card.red ? "text-red-600" : ""}`}>{card.value}</p>
                        {card.sub ? (
                          <p className={`mt-0.5 truncate text-xs ${card.dark ? "text-white/55" : "text-black/45"}`}>
                            {card.sub}
                          </p>
                        ) : null}
                      </article>
                    ))}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
                    {[
                      ["receipt", "Search receipt no."],
                      ["item", "Search item name or ID"],
                    ].map(([key, placeholder]) => (
                      <span key={key} className="relative block">
                        <FontAwesomeIcon
                          icon={faMagnifyingGlass}
                          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black/35"
                        />
                        <input
                          type="search"
                          value={branchSalesSearch[key]}
                          onChange={(event) => {
                            setBranchSalesSearch((current) => ({ ...current, [key]: event.target.value }));
                            setBranchSalesPage(1);
                          }}
                          placeholder={placeholder}
                          aria-label={placeholder}
                          className="h-11 w-full rounded-xl border border-black/10 bg-white pl-10 pr-3 text-sm font-medium text-black outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                        />
                      </span>
                    ))}
                  </div>

                  {branchSalesMessage ? <p className="text-sm text-red-600">{branchSalesMessage}</p> : null}

                  <div className="overflow-x-auto rounded-2xl border border-black/8">
                    <div className="grid min-w-[960px] grid-cols-[150px_170px_1.6fr_70px_90px_120px_150px_60px] gap-3 bg-black px-4 py-3 text-xs font-semibold uppercase text-white/65">
                      <span>Receipt</span>
                      <span>Date &amp; time</span>
                      <span>Items sold</span>
                      <span>Qty</span>
                      <span>Returned</span>
                      <span>Amount</span>
                      <span>Status</span>
                      <span />
                    </div>

                    {branchSalesLoading && !branchSales ? (
                      <div className="px-4 py-8 text-center text-sm text-black/55">Loading sales...</div>
                    ) : null}

                    {branchSales && branchSales.sales.length === 0 ? (
                      <div className="px-4 py-10 text-center">
                        <h3 className="text-lg font-semibold text-black">No sales found</h3>
                        <p className="mt-2 text-sm text-black/55">
                          No POS sales for {selectedBranch.name} match this date range or search.
                        </p>
                      </div>
                    ) : null}

                    <div className={branchSalesLoading && branchSales ? "opacity-50 transition" : "transition"}>
                      {branchSales?.sales.map((sale, index) => (
                        <article
                          key={sale.id}
                          className={`grid min-w-[960px] grid-cols-[150px_170px_1.6fr_70px_90px_120px_150px_60px] items-center gap-3 px-4 py-3 text-sm ${
                            index > 0 ? "border-t border-black/8" : ""
                          }`}
                        >
                          <p className="truncate font-mono font-semibold text-black">{sale.receiptCode}</p>
                          <p className="text-black/65">{new Date(sale.createdAt).toLocaleString()}</p>
                          <p className="truncate text-black/80" title={sale.itemSold}>
                            {sale.itemSold}
                          </p>
                          <p className="font-semibold text-black">{sale.totalItems}</p>
                          <p className={sale.returnedItems > 0 ? "font-semibold text-red-600" : "text-black/40"}>
                            {sale.returnedItems > 0 ? sale.returnedItems : "-"}
                          </p>
                          <div className="min-w-0">
                            {sale.isFullyReturned ? (
                              <p className="font-semibold text-red-600">-{formatMoney(sale.totalAmount)}</p>
                            ) : (
                              <>
                                <p className="font-semibold text-black">
                                  {formatMoney(sale.totalAmount - sale.returnedAmount)}
                                </p>
                                {sale.returnedAmount > 0 ? (
                                  <p className="truncate text-xs text-black/40 line-through">
                                    {formatMoney(sale.totalAmount)}
                                  </p>
                                ) : null}
                              </>
                            )}
                          </div>
                          <span>
                            <SaleStatusBadge sale={sale} />
                          </span>
                          <button
                            type="button"
                            onClick={() => handleOpenReceipt(sale)}
                            aria-label={`View receipt ${sale.receiptCode}`}
                            title="View receipt"
                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-black/8 text-black/70 transition hover:bg-brand/15 hover:text-black"
                          >
                            <FontAwesomeIcon icon={faEye} />
                          </button>
                        </article>
                      ))}
                    </div>
                  </div>

                  {branchSales && branchSales.total > 0 ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-black/55">
                      <p>
                        Showing {(branchSales.page - 1) * branchSales.limit + 1}-
                        {Math.min(branchSales.page * branchSales.limit, branchSales.total)} of {branchSales.total}
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setBranchSalesPage((current) => Math.max(1, current - 1))}
                          disabled={branchSales.page <= 1 || branchSalesLoading}
                          aria-label="Previous page"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-black/10 text-black transition hover:bg-black/5 disabled:opacity-30"
                        >
                          <FontAwesomeIcon icon={faChevronLeft} />
                        </button>
                        <span className="font-semibold text-black">
                          {branchSales.page} / {branchSales.totalPages}
                        </span>
                        <button
                          type="button"
                          onClick={() => setBranchSalesPage((current) => current + 1)}
                          disabled={branchSales.page >= branchSales.totalPages || branchSalesLoading}
                          aria-label="Next page"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-black/10 text-black transition hover:bg-black/5 disabled:opacity-30"
                        >
                          <FontAwesomeIcon icon={faChevronRight} />
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {branchRecordTab === "Inventory" ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {[
                      { lowOnly: false, label: "All items", count: branchInventoryItems.length },
                      { lowOnly: true, label: "Low stock", count: branchLowStockItems.length },
                    ].map((filter) => (
                      <button
                        key={filter.label}
                        type="button"
                        onClick={() => setBranchInventoryLowOnly(filter.lowOnly)}
                        className={`inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-semibold transition ${
                          branchInventoryLowOnly === filter.lowOnly
                            ? filter.lowOnly
                              ? "bg-red-600 text-white"
                              : "bg-black text-white"
                            : "border border-black/10 text-black/65 hover:bg-black/5 hover:text-black"
                        }`}
                      >
                        {filter.lowOnly ? <FontAwesomeIcon icon={faTriangleExclamation} className="text-xs" /> : null}
                        {filter.label}
                        <span
                          className={`rounded-full px-1.5 text-xs ${
                            branchInventoryLowOnly === filter.lowOnly ? "bg-white/20" : "bg-black/5"
                          }`}
                        >
                          {filter.count}
                        </span>
                      </button>
                    ))}
                    <span className="text-xs text-black/45">
                      Low stock = {inventoryLowStockThreshold} or fewer left
                    </span>
                  </div>

                  {branchInventoryMessage ? (
                    <p className="text-sm text-red-600">{branchInventoryMessage}</p>
                  ) : null}

                  <div className="overflow-x-auto rounded-2xl border border-black/8">
                    <div className="grid min-w-[1320px] grid-cols-[80px_90px_1.3fr_160px_140px_1.1fr_120px_120px_180px] gap-3 bg-black px-4 py-3 text-xs font-semibold uppercase text-white/65">
                      <span>ID</span>
                      <span>Image</span>
                      <span>Item name</span>
                      <span>SKU</span>
                      <span>Category</span>
                      <span>Branch name</span>
                      <span>Stock</span>
                      <span>Price</span>
                      <span>History</span>
                    </div>

                    {branchInventoryLoading ? (
                      <div className="px-4 py-8 text-center text-sm text-black/55">
                        Loading branch inventory...
                      </div>
                    ) : null}

                    {!branchInventoryLoading && visibleBranchInventoryItems.length === 0 ? (
                      <div className="px-4 py-10 text-center">
                        <h3 className="text-lg font-semibold text-black">
                          {branchInventoryLowOnly ? "No low stock items" : "No inventory items yet"}
                        </h3>
                        <p className="mt-2 text-sm text-black/55">
                          {branchInventoryLowOnly
                            ? `Every item at ${selectedBranch.name} has more than ${inventoryLowStockThreshold} in stock.`
                            : `No items are assigned to ${selectedBranch.name} for this branch view.`}
                        </p>
                      </div>
                    ) : null}

                    {!branchInventoryLoading
                      ? pagedBranchInventoryItems.map((item, index) => {
                          const branchStock = getBranchInventoryStock(item);

                          return (
                            <article
                              key={item.id}
                              className={`grid min-w-[1320px] grid-cols-[80px_90px_1.3fr_160px_140px_1.1fr_120px_120px_180px] items-center gap-3 px-4 py-4 text-sm transition ${
                                getStockRowTone(branchStock, inventoryLowStockThreshold).row
                              } ${index > 0 ? "border-t border-black/8" : ""}`}
                            >
                              <p className="font-semibold text-black/70">#{item.id}</p>
                              {item.imageUrl ? (
                                <button
                                  type="button"
                                  onClick={() => handleViewInventoryImage(item)}
                                  className="inline-flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl border border-black/8 bg-black/3 transition hover:ring-2 hover:ring-brand/30"
                                >
                                  <img
                                    src={getInventoryImageSrc(item)}
            loading="lazy"
                                    alt={item.imageName || item.name}
                                    className="h-full w-full object-cover"
                                  />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleViewInventoryImage(item)}
                                  className="inline-flex h-14 w-14 items-center justify-center rounded-xl border border-dashed border-black/15 bg-black/3 text-black/35"
                                  title="No image"
                                >
                                  <FontAwesomeIcon icon={faImage} />
                                </button>
                              )}
                              <p className="truncate font-semibold text-black">{item.name}</p>
                              <p className="truncate text-black/70" title={formatSkuLabel(item)}>
                                {formatSkuLabel(item) || "-"}
                              </p>
                              <p className="truncate text-black/70" title={item.categoryName || ""}>
                                {item.categoryName || "-"}
                              </p>
                              <p className="truncate text-black/70">{selectedBranch.name}</p>
                              <p>
                                {branchStock <= inventoryLowStockThreshold ? (
                                  <span
                                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                                      branchStock <= 0 ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"
                                    }`}
                                  >
                                    {branchStock} · {branchStock <= 0 ? "Out" : "Low"}
                                  </span>
                                ) : (
                                  <span className="font-medium text-black/70">{branchStock}</span>
                                )}
                              </p>
                              <p className="font-medium text-black/70">{formatMoney(item.price)}</p>
                              <p className="text-xs text-black/50">
                                POS history pending
                                <span className="block">
                                  {branchDateRange.from} to {branchDateRange.to}
                                </span>
                              </p>
                            </article>
                          );
                        })
                      : null}
                  </div>

                  <Pagination
                    page={currentBranchInventoryPage}
                    pageSize={10}
                    total={visibleBranchInventoryItems.length}
                    onChange={setBranchInventoryPage}
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-xl font-semibold text-black">All branches</h3>
                  <p className="mt-1 text-sm text-black/55">
                    Manage branch access, POS codes, status, and order.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddBranch}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-black transition hover:brightness-95"
                >
                  <FontAwesomeIcon icon={faPlus} />
                  Add branch
                </button>
              </div>

              {branchesMessage ? <p className="text-sm text-red-600">{branchesMessage}</p> : null}

              <div className="overflow-x-auto rounded-2xl border border-black/8">
                <div className="grid min-w-[560px] grid-cols-[80px_1fr_110px_170px] gap-3 bg-black px-4 py-3 text-xs font-semibold uppercase text-white/65">
                  <span>Sort</span>
                  <span>Name</span>
                  <span>Status</span>
                  <span>Actions</span>
                </div>

                {branchesLoading ? (
                  <div className="px-4 py-8 text-center text-sm text-black/55">Loading branches...</div>
                ) : null}

                {!branchesLoading && branches.length === 0 ? (
                  <div className="px-4 py-10 text-center">
                    <h4 className="text-lg font-semibold text-black">No branches yet</h4>
                    <p className="mt-2 text-sm text-black/55">Add your first branch to start managing it here.</p>
                  </div>
                ) : null}

                {!branchesLoading
                  ? branches.map((branch, index) => (
                      <article
                        key={branch.id}
                        className={`grid min-w-[560px] grid-cols-[80px_1fr_110px_170px] items-center gap-3 px-4 py-4 text-sm ${
                          index > 0 ? "border-t border-black/8" : ""
                        } ${branch.isDisabled ? "bg-black/3 text-black/45" : "bg-white text-black"}`}
                      >
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleSortBranch(branch, "up")}
                            disabled={index === 0}
                            title="Move up"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-black/8 text-black/60 transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <FontAwesomeIcon icon={faArrowUp} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSortBranch(branch, "down")}
                            disabled={index === branches.length - 1}
                            title="Move down"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-black/8 text-black/60 transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <FontAwesomeIcon icon={faArrowDown} />
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleOpenBranch(branch)}
                          className="truncate text-left font-semibold text-black underline-offset-4 transition hover:text-brand hover:underline"
                        >
                          {branch.name}
                        </button>
                        <span
                          className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${
                            branch.isDisabled
                              ? "bg-red-50 text-red-600"
                              : "bg-brand/20 text-black"
                          }`}
                        >
                          {branch.isDisabled ? "Disabled" : "Active"}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleViewBranch(branch)}
                            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-black/8 px-3 text-xs font-semibold text-black transition hover:bg-black/5"
                          >
                            <FontAwesomeIcon icon={faEye} />
                            View
                          </button>
                          <button
                            type="button"
                            onClick={() => handleEditBranch(branch)}
                            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-black/8 px-3 text-xs font-semibold text-black transition hover:bg-black/5"
                          >
                            <FontAwesomeIcon icon={faPen} />
                            Edit
                          </button>
                        </div>
                      </article>
                    ))
                  : null}
              </div>
            </div>
          )
        ) : null}

        {activeSection === "Settings" ? (
          <div className="mx-auto max-w-4xl space-y-6">
            <div className="inline-flex w-full rounded-2xl bg-black/5 p-1 sm:w-auto">
              {settingsTabs.map((tab) => (
                <button
                  key={tab.label}
                  type="button"
                  onClick={() => setSettingsTab(tab.label)}
                  className={`inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold transition sm:flex-none ${
                    settingsTab === tab.label ? "bg-white text-black shadow-sm" : "text-black/55 hover:text-black"
                  }`}
                >
                  <FontAwesomeIcon icon={tab.icon} />
                  {tab.label}
                </button>
              ))}
            </div>

            {settingsTab === "Account" ? (
              <>
                <SettingsCard
                  icon={faCamera}
                  title="Profile picture & banner"
                  description="These show at the top of your profile."
                >
                  <div className="relative h-36 overflow-hidden rounded-2xl bg-gradient-to-r from-black via-black/85 to-brand/70 sm:h-48">
                    {auth.user.bannerImage ? (
                      <img src={auth.user.bannerImage} alt="Banner" className="h-full w-full object-cover" />
                    ) : null}
                    <div className="absolute bottom-3 right-3 flex gap-2">
                      {auth.user.bannerImage ? (
                        <button
                          type="button"
                          onClick={() => handleImageUpdate("banner", null)}
                          disabled={savingImage === "banner"}
                          aria-label="Remove banner"
                          title="Remove banner"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/90 text-sm text-red-600 shadow-sm transition hover:bg-white disabled:opacity-60"
                        >
                          <FontAwesomeIcon icon={faTrashCan} />
                        </button>
                      ) : null}
                      <ImagePickerButton
                        id="banner-image-input"
                        onFile={(file) => handleImageUpdate("banner", file)}
                        disabled={savingImage === "banner"}
                        className="h-9 rounded-xl bg-white/90 px-3 text-sm font-semibold text-black shadow-sm hover:bg-white"
                      >
                        <FontAwesomeIcon icon={faCamera} />
                        {savingImage === "banner" ? "Saving..." : auth.user.bannerImage ? "Change banner" : "Add banner"}
                      </ImagePickerButton>
                    </div>
                  </div>

                  <div className="-mt-10 flex flex-col gap-3 px-3 sm:-mt-12 sm:flex-row sm:items-end sm:px-5">
                    <div className="relative w-fit">
                      <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-4 border-white bg-brand/20 text-2xl font-semibold text-black shadow-panel sm:h-28 sm:w-28">
                        {auth.user.profileImage ? (
                          <img src={auth.user.profileImage} alt="Profile" className="h-full w-full object-cover" />
                        ) : (
                          getInitials(auth.user.name)
                        )}
                      </div>
                      <ImagePickerButton
                        id="profile-image-input"
                        onFile={(file) => handleImageUpdate("profile", file)}
                        disabled={savingImage === "profile"}
                        className="absolute bottom-1 right-1 h-9 w-9 rounded-full border-2 border-white bg-black text-sm text-white shadow-sm hover:bg-black/85"
                      >
                        <FontAwesomeIcon icon={faCamera} />
                        <span className="sr-only">Change profile picture</span>
                      </ImagePickerButton>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 pb-1 text-sm">
                      <span className="text-black/50">
                        {savingImage === "profile" ? "Saving profile picture..." : "Tap the camera to change your photo."}
                      </span>
                      {auth.user.profileImage ? (
                        <button
                          type="button"
                          onClick={() => handleImageUpdate("profile", null)}
                          disabled={savingImage === "profile"}
                          className="font-semibold text-red-600 transition hover:text-red-700 disabled:opacity-60"
                        >
                          Remove photo
                        </button>
                      ) : null}
                    </div>
                  </div>
                </SettingsCard>

                <form onSubmit={handleAccountSave}>
                  <SettingsCard
                    icon={faUser}
                    title="Account information"
                    description="Your name, username, and email."
                    footer={
                      <>
                        {accountFormChanged ? (
                          <button
                            type="button"
                            onClick={() => setAccountForm(getAccountFormValues(auth.user))}
                            className="h-10 rounded-xl px-4 text-sm font-semibold text-black/60 transition hover:bg-black/5 hover:text-black"
                          >
                            Cancel
                          </button>
                        ) : null}
                        <SaveButton busy={savingForm === "account"} disabled={!accountFormChanged}>
                          Save changes
                        </SaveButton>
                      </>
                    }
                  >
                    <div className="grid gap-4 sm:grid-cols-2">
                      {[
                        { key: "firstName", label: "First name", icon: faUser, autoComplete: "given-name" },
                        { key: "lastName", label: "Last name", icon: faUser, autoComplete: "family-name" },
                        { key: "username", label: "Username", icon: faCircleCheck, autoComplete: "username" },
                        { key: "email", label: "Email", icon: faEnvelope, autoComplete: "email", type: "email" },
                      ].map((field) => (
                        <SettingsInput
                          key={field.key}
                          label={field.label}
                          icon={field.icon}
                          type={field.type}
                          autoComplete={field.autoComplete}
                          value={accountForm[field.key]}
                          onChange={(event) =>
                            setAccountForm((current) => ({ ...current, [field.key]: event.target.value }))
                          }
                          required
                        />
                      ))}
                    </div>
                  </SettingsCard>
                </form>

                <form onSubmit={handlePasswordSave}>
                  <SettingsCard
                    icon={faLock}
                    title="Password"
                    description="Use at least 8 characters."
                    footer={
                      <>
                        <button
                          type="button"
                          onClick={handleForgotPassword}
                          disabled={savingForm === "forgot"}
                          className="mr-auto h-10 rounded-xl px-1 text-sm font-semibold text-black/60 underline-offset-4 transition hover:text-black hover:underline disabled:opacity-60"
                        >
                          {savingForm === "forgot" ? "Sending link..." : "Forgot password?"}
                        </button>
                        <SaveButton
                          busy={savingForm === "password"}
                          disabled={Object.values(passwordForm).some((value) => !value)}
                        >
                          Update password
                        </SaveButton>
                      </>
                    }
                  >
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <SettingsInput
                          label="Current password"
                          icon={faKey}
                          type="password"
                          autoComplete="current-password"
                          value={passwordForm.currentPassword}
                          onChange={(event) =>
                            setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))
                          }
                          required
                        />
                      </div>
                      <SettingsInput
                        label="New password"
                        icon={faLock}
                        type="password"
                        autoComplete="new-password"
                        minLength={8}
                        value={passwordForm.newPassword}
                        onChange={(event) =>
                          setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))
                        }
                        required
                      />
                      <SettingsInput
                        label="Confirm new password"
                        icon={faLock}
                        type="password"
                        autoComplete="new-password"
                        minLength={8}
                        value={passwordForm.confirmPassword}
                        onChange={(event) =>
                          setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))
                        }
                        required
                      />
                    </div>
                  </SettingsCard>
                </form>
              </>
            ) : null}

            {settingsTab === "Business" ? (
              <>
                <SettingsCard icon={faImage} title="Business logo" description="Shown on your business profile.">
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                    <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-black/10 bg-brand/15 text-2xl text-black/60">
                      {auth.user.businessLogo ? (
                        <img src={auth.user.businessLogo} alt="Business logo" className="h-full w-full object-cover" />
                      ) : (
                        <FontAwesomeIcon icon={faBuilding} />
                      )}
                    </div>
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        <ImagePickerButton
                          id="business-logo-input"
                          onFile={(file) => handleImageUpdate("logo", file)}
                          disabled={savingImage === "logo"}
                          className="h-10 rounded-xl bg-black px-4 text-sm font-semibold text-white hover:bg-black/85"
                        >
                          <FontAwesomeIcon icon={faUpload} />
                          {savingImage === "logo" ? "Saving..." : auth.user.businessLogo ? "Change logo" : "Upload logo"}
                        </ImagePickerButton>
                        {auth.user.businessLogo ? (
                          <button
                            type="button"
                            onClick={() => handleImageUpdate("logo", null)}
                            disabled={savingImage === "logo"}
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-black/10 px-4 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-60"
                          >
                            <FontAwesomeIcon icon={faTrashCan} />
                            Remove
                          </button>
                        ) : null}
                      </div>
                      <p className="text-xs text-black/45">PNG, JPG, WEBP, or GIF. You can crop it after choosing.</p>
                    </div>
                  </div>
                </SettingsCard>

                <form onSubmit={handleBusinessSave}>
                  <SettingsCard
                    icon={faBuilding}
                    title="Business details"
                    description="Renaming the business gives it a new Business Code."
                    footer={
                      <>
                        {businessFormChanged ? (
                          <button
                            type="button"
                            onClick={() => setBusinessForm({ businessName: auth.user.businessName || "", password: "" })}
                            className="h-10 rounded-xl px-4 text-sm font-semibold text-black/60 transition hover:bg-black/5 hover:text-black"
                          >
                            Cancel
                          </button>
                        ) : null}
                        <SaveButton
                          busy={savingForm === "business"}
                          disabled={!businessFormChanged || !businessForm.password}
                        >
                          Save changes
                        </SaveButton>
                      </>
                    }
                  >
                    <div className="grid gap-4 sm:grid-cols-2">
                      <SettingsInput
                        label="Business name"
                        icon={faBuilding}
                        autoComplete="organization"
                        maxLength={160}
                        value={businessForm.businessName}
                        onChange={(event) =>
                          setBusinessForm((current) => ({ ...current, businessName: event.target.value }))
                        }
                        required
                      />
                      <SettingsInput
                        label="Business code"
                        icon={faKey}
                        value={
                          auth.user.businessCode
                            ? settingsCodeVisible
                              ? auth.user.businessCode
                              : "•".repeat(auth.user.businessCode.length)
                            : "-"
                        }
                        readOnly
                        hint={
                          businessFormChanged
                            ? "A new unique code will be generated when you save."
                            : "Used to sign in to the POS."
                        }
                        action={
                          auth.user.businessCode ? (
                            <button
                              type="button"
                              onClick={() => setSettingsCodeVisible((current) => !current)}
                              aria-label={settingsCodeVisible ? "Hide business code" : "Show business code"}
                              title={settingsCodeVisible ? "Hide business code" : "Show business code"}
                              className="-mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-black/45 transition hover:bg-brand/15 hover:text-black"
                            >
                              <FontAwesomeIcon icon={settingsCodeVisible ? faEyeSlash : faEye} />
                            </button>
                          ) : null
                        }
                      />
                      {businessFormChanged ? (
                        <div className="sm:col-span-2">
                          <SettingsInput
                            label="Your password"
                            icon={faLock}
                            type="password"
                            autoComplete="current-password"
                            placeholder="Enter your password to confirm"
                            value={businessForm.password}
                            onChange={(event) =>
                              setBusinessForm((current) => ({ ...current, password: event.target.value }))
                            }
                            hint="Required to rename the business."
                            required
                          />
                        </div>
                      ) : null}
                    </div>
                  </SettingsCard>
                </form>

                <SkuManager requestApi={requestBranchApi} branches={branches} />

                <SettingsCard
                  icon={faShieldHeart}
                  title="Admin settings"
                  description="Stock alerts and the branch names and codes used by the POS."
                >
                  <div className="space-y-6">
                    <form onSubmit={handleThresholdSave}>
                      <p className="text-sm font-semibold text-black">Low stock alert</p>
                      <p className="mb-3 text-sm text-black/50">
                        An item counts as low stock when this many or fewer are left.
                      </p>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                        <div className="sm:w-56">
                          <SettingsInput
                            label="Low stock at or below"
                            icon={faTriangleExclamation}
                            type="number"
                            min={0}
                            step={1}
                            inputMode="numeric"
                            value={thresholdInput}
                            onChange={(event) => setThresholdInput(event.target.value)}
                            required
                          />
                        </div>
                        <SaveButton
                          busy={savingForm === "threshold"}
                          disabled={
                            thresholdInput === "" ||
                            Number(thresholdInput) === (auth.user.lowStockThreshold ?? 3)
                          }
                        >
                          Save
                        </SaveButton>
                      </div>
                    </form>

                    <div className="border-t border-black/8 pt-6">
                      <p className="text-sm font-semibold text-black">Branches</p>
                      <p className="mb-3 text-sm text-black/50">
                        The branch code is what each branch types to sign in to the POS.
                      </p>

                      {branchesLoading && branches.length === 0 ? (
                        <p className="text-sm text-black/45">Loading branches...</p>
                      ) : null}
                      {!branchesLoading && branches.length === 0 ? (
                        <p className="text-sm text-black/45">No branches yet. Add one in Branches.</p>
                      ) : null}

                      <div className="space-y-3">
                        {branches.map((branch) => {
                          const edit = getBranchEdit(branch);
                          const changed = edit.name.trim() !== branch.name || edit.posCode.trim() !== branch.posCode;

                          return (
                            <form
                              key={branch.id}
                              onSubmit={(event) => handleBranchSettingsSave(event, branch)}
                              className="rounded-2xl border border-black/8 bg-black/[0.02] p-4"
                            >
                              {branch.isDisabled ? (
                                <span className="mb-2 inline-flex rounded-full bg-black/5 px-2.5 py-0.5 text-xs font-semibold text-black/50">
                                  Disabled
                                </span>
                              ) : null}
                              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                                <SettingsInput
                                  label="Branch name"
                                  icon={faBuilding}
                                  value={edit.name}
                                  onChange={(event) => updateBranchEdit(branch, "name", event.target.value)}
                                  required
                                />
                                <SettingsInput
                                  label="Branch code"
                                  icon={faKey}
                                  type="password"
                                  autoComplete="new-password"
                                  value={edit.posCode}
                                  onChange={(event) => updateBranchEdit(branch, "posCode", event.target.value)}
                                  required
                                />
                                <div className="flex gap-2">
                                  {changed ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setBranchEdits((current) => {
                                          const next = { ...current };
                                          delete next[branch.id];
                                          return next;
                                        })
                                      }
                                      className="h-10 rounded-xl px-3 text-sm font-semibold text-black/60 transition hover:bg-black/5 hover:text-black"
                                    >
                                      Cancel
                                    </button>
                                  ) : null}
                                  <SaveButton
                                    busy={savingBranchId === branch.id}
                                    disabled={!changed || !edit.name.trim() || !edit.posCode.trim()}
                                  >
                                    Save
                                  </SaveButton>
                                </div>
                              </div>
                            </form>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </SettingsCard>
              </>
            ) : null}

            {settingsTab === "Accounts" ? (
              <AccountsManager requestApi={requestBranchApi} branches={branches} />
            ) : null}
          </div>
        ) : null}
      </section>
      </div>

      {inventoryModal?.type === "add" || inventoryModal?.type === "edit" ? (
        <InventoryItemModal
          key={`${inventoryModal.type}-${inventoryModal.item?.id ?? "new"}`}
          mode={inventoryModal.type}
          item={inventoryModal.item}
          branches={branches}
          skus={skus}
          canDelete={inventoryFilter === "all"}
          onClose={() => setInventoryModal(null)}
          onSave={saveInventoryItem}
          onDelete={deleteInventoryItem}
        />
      ) : null}

      {inventoryModal?.type === "stock" ? (
        <InventoryStockModal
          key={`stock-${inventoryModal.item.id}`}
          item={inventoryModal.item}
          branches={branches}
          branch={
            inventoryFilter === "all"
              ? null
              : branches.find((branch) => String(branch.id) === String(inventoryFilter)) || null
          }
          onClose={() => setInventoryModal(null)}
          onSave={saveInventoryStock}
        />
      ) : null}

      {inventoryModal?.type === "history" ? (
        <InventoryHistoryModal
          key={`history-${inventoryModal.item.id}`}
          item={inventoryModal.item}
          requestApi={requestBranchApi}
          onClose={() => setInventoryModal(null)}
        />
      ) : null}

      {inventoryModal?.type === "image" ? (
        <InventoryImageModal item={inventoryModal.item} onClose={() => setInventoryModal(null)} />
      ) : null}

      {branchModal ? (
        <BranchModal
          key={`${branchModal.mode}-${branchModal.branch?.id ?? "new"}`}
          mode={branchModal.mode}
          branch={branchModal.branch}
          onClose={() => setBranchModal(null)}
          onEdit={
            permissions.sections.branches ? () => setBranchModal({ mode: "edit", branch: branchModal.branch }) : undefined
          }
          onSave={handleBranchModalSave}
          onToggle={handleBranchModalToggle}
          onDelete={handleBranchModalDelete}
        />
      ) : null}

      {branchReceipt ? (
        <ReceiptModal
          receipt={branchReceipt.receipt}
          loading={branchReceipt.loading}
          error={branchReceipt.error}
          onClose={() => setBranchReceipt(null)}
        />
      ) : null}

      {cropRequest ? (
        <ImageCropModal
          title={`Crop ${imageSettings[cropRequest.kind].label.toLowerCase()}`}
          source={cropRequest.source}
          aspect={imageSettings[cropRequest.kind].width / imageSettings[cropRequest.kind].height}
          onCancel={() => setCropRequest(null)}
          onConfirm={handleCropConfirm}
        />
      ) : null}
    </main>
  );
}

function LoginPage({ onLogin, auth }) {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  if (auth) {
    return <Navigate to="/app" replace />;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(`${apiBaseUrl}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message || "Unable to sign in.");
      }

      onLogin(payload);
      navigate("/app");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Secure Login"
      title="Sign in to CowFlo"
      footer={
        <p className="text-xs text-white/45">
          <FontAwesomeIcon icon={faShieldHeart} className="mr-1.5 text-brand" />
          Access your operations dashboard with your owner-approved account.
        </p>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <InputField
          icon={faUser}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="Username"
          autoComplete="username"
        />
        <PasswordField
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          autoComplete="current-password"
        />
        <div className="-mt-1 flex justify-end">
          <button
            type="button"
            onClick={() => navigate("/forgot-password")}
            className="text-xs font-semibold text-white/55 transition hover:text-brand"
          >
            Forgot password?
          </button>
        </div>
        {message ? <p className="text-sm font-medium text-red-400">{message}</p> : null}
        <button
          type="submit"
          disabled={loading}
          className="inline-flex w-full items-center justify-center gap-3 rounded-xl bg-brand px-5 py-4 text-sm font-bold text-black shadow-lg shadow-brand/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? "Signing in..." : "Sign in"}
          <FontAwesomeIcon icon={faArrowRight} />
        </button>
      </form>
    </AuthShell>
  );
}

function SignupPage({ onLogin, auth }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    username: "",
    businessName: "",
    email: "",
    password: "",
    confirmPassword: "",
    accessKey: "",
    businessCode: "",
  });
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  if (auth) {
    return <Navigate to="/app" replace />;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(`${apiBaseUrl}/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message || "Unable to create account.");
      }

      onLogin(payload);
      navigate("/app");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      wide
      eyebrow="Owner Signup"
      title="Create your private CowFlo account"
      footer={
        <button
          type="button"
          onClick={() => navigate("/login")}
          className="inline-flex items-center gap-2 text-sm font-semibold text-white/55 transition hover:text-brand"
        >
          <FontAwesomeIcon icon={faArrowLeft} />
          Back to login
        </button>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <InputField
            icon={faUser}
            value={form.firstName}
            onChange={(event) =>
              setForm((current) => ({ ...current, firstName: event.target.value }))
            }
            placeholder="First Name"
            autoComplete="given-name"
          />
          <InputField
            icon={faUser}
            value={form.lastName}
            onChange={(event) =>
              setForm((current) => ({ ...current, lastName: event.target.value }))
            }
            placeholder="Last Name"
            autoComplete="family-name"
          />
        </div>
        <InputField
          icon={faUser}
          value={form.username}
          onChange={(event) =>
            setForm((current) => ({ ...current, username: event.target.value }))
          }
          placeholder="Username"
          autoComplete="username"
        />
        <InputField
          icon={faBuilding}
          value={form.businessName}
          onChange={(event) =>
            setForm((current) => ({ ...current, businessName: event.target.value }))
          }
          placeholder="Business Name"
          autoComplete="organization"
        />
        <label className={authFieldClass}>
          <span className="text-white/45 transition group-focus-within:text-brand">
            <FontAwesomeIcon icon={faKey} />
          </span>
          <input
            value={form.businessCode}
            onChange={(event) => setForm((current) => ({ ...current, businessCode: event.target.value }))}
            placeholder="Business Code (only to join an existing business)"
            autoComplete="off"
            className="w-full border-0 bg-transparent text-sm uppercase text-white outline-none placeholder:normal-case placeholder:text-white/40"
          />
        </label>
        <p className="-mt-2 px-1 text-xs text-white/45">
          {form.businessCode.trim()
            ? "You will join this business. The owner decides what you can see."
            : "Leave Business Code empty to create a new business."}
        </p>
        <InputField
          icon={faEnvelope}
          type="email"
          value={form.email}
          onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
          placeholder="Email address"
          autoComplete="email"
        />
        <PasswordField
          value={form.password}
          onChange={(event) =>
            setForm((current) => ({ ...current, password: event.target.value }))
          }
          placeholder="Password"
          autoComplete="new-password"
        />
        <PasswordField
          value={form.confirmPassword}
          onChange={(event) =>
            setForm((current) => ({ ...current, confirmPassword: event.target.value }))
          }
          placeholder="Confirm Password"
          autoComplete="new-password"
        />
        <InputField
          icon={faKey}
          type="password"
          value={form.accessKey}
          onChange={(event) =>
            setForm((current) => ({ ...current, accessKey: event.target.value }))
          }
          placeholder="cow_flow_sign_up_pass"
          autoComplete="one-time-code"
        />
        {message ? <p className="text-sm font-medium text-red-400">{message}</p> : null}
        <button
          type="submit"
          disabled={loading}
          className="inline-flex w-full items-center justify-center gap-3 rounded-xl bg-brand px-5 py-4 text-sm font-bold text-black shadow-lg shadow-brand/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? "Creating account..." : form.businessCode.trim() ? "Join business" : "Create account"}
          <FontAwesomeIcon icon={faArrowRight} />
        </button>
      </form>
    </AuthShell>
  );
}

const authSubmitClass =
  "inline-flex w-full items-center justify-center gap-3 rounded-xl bg-brand px-5 py-4 text-sm font-bold text-black shadow-lg shadow-brand/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70";

function BackToLoginButton() {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      onClick={() => navigate("/login")}
      className="inline-flex items-center gap-2 text-sm font-semibold text-white/55 transition hover:text-brand"
    >
      <FontAwesomeIcon icon={faArrowLeft} />
      Back to login
    </button>
  );
}

function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState("");
  const [message, setMessage] = useState("");
  const [sentMessage, setSentMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(`${apiBaseUrl}/auth/password-reset/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message || "Unable to send the reset link.");
      }

      setSentMessage(payload.message);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Forgot password"
      title="Reset your password"
      description="Enter your email or username and we will email you a link to set a new password."
      footer={<BackToLoginButton />}
    >
      {sentMessage ? (
        <div className="rounded-xl border border-brand/30 bg-brand/10 px-4 py-4 text-center text-sm text-white/80">
          <FontAwesomeIcon icon={faEnvelope} className="mb-2 text-2xl text-brand" />
          <p>{sentMessage}</p>
          <p className="mt-1 text-white/50">The link expires in 30 minutes.</p>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={handleSubmit}>
          <InputField
            icon={faEnvelope}
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder="Email or username"
            autoComplete="username"
          />
          {message ? <p className="text-sm font-medium text-red-400">{message}</p> : null}
          <button type="submit" disabled={loading} className={authSubmitClass}>
            {loading ? "Sending link..." : "Send reset link"}
            <FontAwesomeIcon icon={faArrowRight} />
          </button>
        </form>
      )}
    </AuthShell>
  );
}

function ResetPasswordPage() {
  const navigate = useNavigate();
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const [linkState, setLinkState] = useState({ checking: true, email: "", error: "" });
  const [form, setForm] = useState({ password: "", confirmPassword: "" });
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${apiBaseUrl}/auth/password-reset/verify?token=${encodeURIComponent(token)}`)
      .then(async (response) => {
        const payload = await response.json();

        setLinkState(
          response.ok
            ? { checking: false, email: payload.email, error: "" }
            : { checking: false, email: "", error: payload.message || "This reset link is invalid." },
        );
      })
      .catch(() => setLinkState({ checking: false, email: "", error: "Unable to check the reset link." }));
  }, [token]);

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");

    if (form.password !== form.confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${apiBaseUrl}/auth/password-reset/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, ...form }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message || "Unable to change the password.");
      }

      await Swal.fire("Password changed", payload.message, "success");
      navigate("/login", { replace: true });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      eyebrow="New password"
      title="Set a new password"
      description={linkState.email ? `For ${linkState.email}. Use at least 8 characters.` : "Use at least 8 characters."}
      footer={<BackToLoginButton />}
    >
      {linkState.checking ? (
        <p className="text-center text-sm text-white/55">Checking your link...</p>
      ) : linkState.error ? (
        <div className="space-y-4 text-center">
          <p className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {linkState.error}
          </p>
          <button type="button" onClick={() => navigate("/forgot-password")} className={authSubmitClass}>
            Ask for a new link
            <FontAwesomeIcon icon={faArrowRight} />
          </button>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={handleSubmit}>
          <PasswordField
            value={form.password}
            onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
            placeholder="New password"
            autoComplete="new-password"
          />
          <PasswordField
            value={form.confirmPassword}
            onChange={(event) => setForm((current) => ({ ...current, confirmPassword: event.target.value }))}
            placeholder="Confirm new password"
            autoComplete="new-password"
          />
          {message ? <p className="text-sm font-medium text-red-400">{message}</p> : null}
          <button type="submit" disabled={loading} className={authSubmitClass}>
            {loading ? "Saving..." : "Save new password"}
            <FontAwesomeIcon icon={faArrowRight} />
          </button>
        </form>
      )}
    </AuthShell>
  );
}

function ProtectedRoute({ auth, children }) {
  if (!auth) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

export default function App() {
  const [auth, setAuth] = useState(readSavedAuth);

  useEffect(() => {
    saveAuth(auth);

    if (!auth) {
      return undefined;
    }

    const expiresAt = getAuthExpiresAt(auth);

    if (!expiresAt) {
      return undefined;
    }

    const timeUntilExpiry = expiresAt - Date.now();

    if (timeUntilExpiry <= 0) {
      setAuth(null);
      return undefined;
    }

    const expiryTimer = window.setTimeout(() => {
      setAuth(null);
    }, Math.min(timeUntilExpiry, 2147483647));

    return () => window.clearTimeout(expiryTimer);
  }, [auth]);

  return (
    <AppErrorBoundary>
      <Routes>
        <Route path="/" element={<Navigate to={auth ? "/app" : "/login"} replace />} />
        <Route path="/login" element={<LoginPage auth={auth} onLogin={setAuth} />} />
        <Route path="/signup" element={<SignupPage auth={auth} onLogin={setAuth} />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route
          path="/app"
          element={
            <ProtectedRoute auth={auth}>
              <Dashboard
                auth={auth}
                onLogout={() => setAuth(null)}
                onUserUpdate={(user) => setAuth((current) => (current ? { ...current, user } : current))}
              />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to={auth ? "/app" : "/login"} replace />} />
      </Routes>
    </AppErrorBoundary>
  );
}
