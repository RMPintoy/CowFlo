import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

// Topics the backend broadcasts (see backend/src/realtime.js).
const allTopics = ["inventory", "sales", "skus", "branches", "accounts", "business", "session"];

// "https://api.example.com/api" -> "https://api.example.com". A relative API base ("/api")
// means the API is on this same site, which Socket.IO picks when given no URL.
export function getRealtimeUrl(apiBaseUrl) {
  const origin = String(apiBaseUrl || "").replace(/\/api\/?$/, "");
  return origin.startsWith("http") ? origin : undefined;
}

// Opens one WebSocket for the signed-in screen and calls onChange(topics) whenever another screen
// (or this one) changes data. Bursts are merged so a busy moment triggers one quiet reload.
// Returns whether the live connection is currently up.
export function useLiveUpdates(url, token, onChange) {
  const handlerRef = useRef(onChange);
  const [connected, setConnected] = useState(false);

  handlerRef.current = onChange;

  useEffect(() => {
    if (!token) {
      return undefined;
    }

    const socket = io(url, { auth: { token }, transports: ["websocket", "polling"] });
    let pending = new Set();
    let timer = null;
    let connectedBefore = false;

    const flush = () => {
      timer = null;
      const topics = [...pending];
      pending = new Set();
      handlerRef.current(topics);
    };

    const queue = (topics) => {
      topics.forEach((topic) => pending.add(topic));

      if (!timer) {
        timer = window.setTimeout(flush, 300);
      }
    };

    socket.on("connect", () => {
      setConnected(true);

      // Back after a drop (e.g. the free server woke from sleep): catch up on anything missed.
      if (connectedBefore) {
        queue(allTopics);
      }

      connectedBefore = true;
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => setConnected(false));
    socket.on("change", (event) => queue(Array.isArray(event?.topics) ? event.topics : []));

    return () => {
      window.clearTimeout(timer);
      socket.disconnect();
    };
  }, [url, token]);

  return connected;
}
