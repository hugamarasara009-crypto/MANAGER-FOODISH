import React, { useEffect, useMemo, useRef, useState } from "react";
import { auth, db } from "./firebase";
import { Capacitor } from "@capacitor/core";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { Printer } from "@capgo/capacitor-printer";
import {
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithCredential,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  getDocs,
  where,
  limit,
} from "firebase/firestore";

const COLLECTIONS = {
  orders: "orders",
  restaurants: "mini_restaurants",
  riders: "riders",
  admins: "admins",
  management: "management_entries",
  online: "online_entries",
  locations: "locations",
  paperworkReports: "paperwork_reports",
  riderStatements: "rider_statements",
  restaurantStatements: "restaurant_statements",
};

const money = (value) =>
  `৳${Number(value || 0).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;

const asDate = (value) => {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const dateKey = (value) => {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = asDate(value);
  if (!date) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const todayKey = () => dateKey(new Date());

const formatDateTime = (value) => {
  const date = asDate(value);
  return date
    ? date.toLocaleString("en-BD", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
};

const normalized = (value) => String(value || "").trim().toLowerCase();

const isDelivered = (order) =>
  ["delivered", "complete", "completed", "success"].includes(
    normalized(order.orderStatus)
  );

const isCancelled = (order) =>
  ["cancelled", "canceled", "rejected"].includes(normalized(order.orderStatus));

const isCOD = (order) => {
  const payment = normalized(order.payment || order.paymentMethod);
  return payment === "cod" || payment.includes("cash on delivery");
};

const orderAmount = (order) => Number(order.totalPrice || 0);

const itemSubtotal = (items = [], restaurantName = "", restaurantId = "") => {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, item) => {
    const itemRestaurant = normalized(item.miniResName || item.restaurantName);
    const itemResId = String(item.miniResId || item.restaurantId || "");
    const matchesName = restaurantName && itemRestaurant === normalized(restaurantName);
    const matchesId = restaurantId && itemResId === String(restaurantId);
    if (restaurantName || restaurantId) {
      if (!matchesName && !matchesId) return sum;
    }
    return sum + Number(item.price || 0) * Number(item.quantity || 0);
  }, 0);
};

const getOrderRestaurants = (items = []) => {
  if (!Array.isArray(items) || items.length === 0) return "—";
  const names = items
    .map((item) => item.miniResName || item.restaurantName || item.name)
    .filter(Boolean);
  const uniqueNames = Array.from(new Set(names));
  return uniqueNames.length > 0 ? uniqueNames.join(", ") : "—";
};

const groupItemsByRestaurant = (items = []) => {
  if (!Array.isArray(items)) return [];
  const groups = {};
  items.forEach((item) => {
    const resName = item.miniResName || item.restaurantName || "General Restaurant";
    const resId = String(item.miniResId || item.restaurantId || "");
    const groupKey = resId ? `${resId}_${resName}` : resName;
    if (!groups[groupKey]) {
      groups[groupKey] = {
        name: resName,
        id: resId,
        items: [],
        subtotal: 0,
      };
    }
    const total = Number(item.price || 0) * Number(item.quantity || 1);
    groups[groupKey].items.push(item);
    groups[groupKey].subtotal += total;
  });
  return Object.values(groups);
};

const OrderItemsBreakdown = ({ items = [], highlightRestaurantName = "", highlightRestaurantId = "" }) => {
  const groups = groupItemsByRestaurant(items);
  if (groups.length === 0) return <span>—</span>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
      {groups.map((group, gIdx) => {
        const isCurrentRestaurant =
          Boolean(highlightRestaurantName || highlightRestaurantId) &&
          ((highlightRestaurantName && normalized(group.name) === normalized(highlightRestaurantName)) ||
            (highlightRestaurantId && String(group.id) === String(highlightRestaurantId)));

        return (
          <div
            key={gIdx}
            style={{
              background: isCurrentRestaurant ? "#f0fdf4" : "#f8fafc",
              border: isCurrentRestaurant ? "2px solid #10b981" : "1px solid #e2e8f0",
              borderRadius: "8px",
              padding: "8px 10px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                borderBottom: isCurrentRestaurant ? "1px solid #bbf7d0" : "1px solid #e2e8f0",
                paddingBottom: "4px",
                marginBottom: "6px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <strong style={{ fontSize: "13px", color: isCurrentRestaurant ? "#065f46" : "#1e3a8a" }}>
                  🍽️ {group.name}
                </strong>
                {isCurrentRestaurant && (
                  <span
                    style={{
                      background: "#10b981",
                      color: "#fff",
                      fontSize: "10px",
                      padding: "1px 6px",
                      borderRadius: "10px",
                      fontWeight: "800",
                    }}
                  >
                    THIS RESTAURANT
                  </span>
                )}
              </div>
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: "800",
                  color: isCurrentRestaurant ? "#047857" : "#475569",
                }}
              >
                Subtotal: {money(group.subtotal)}
              </span>
            </div>
            <div style={{ display: "grid", gap: "4px" }}>
              {group.items.map((it, iIdx) => (
                <div
                  key={iIdx}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "12px",
                    color: "#334155",
                  }}
                >
                  <span>
                    • {it.name || it.itemName || "Item"} × <strong>{it.quantity || 1}</strong> ({money(it.price || 0)})
                  </span>
                  <span style={{ fontWeight: "600" }}>
                    {money((it.price || 0) * (it.quantity || 1))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const FoodishLogo = ({ size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 500 500" style={{ display: "inline-block", verticalAlign: "middle" }}>
    <circle cx="250" cy="250" r="230" fill="#dc2626" />
    <circle cx="250" cy="250" r="190" fill="none" stroke="#ffffff" strokeWidth="24" />
    <path d="M162 160 v180 h20 v-180 z" fill="#ffffff" />
    <path d="M202 160 v180 h20 v-180 z" fill="#ffffff" />
    <path d="M242 160 v180 h20 v-180 z" fill="#ffffff" />
    <path d="M162 230 h100 v20 h-100 z" fill="#ffffff" />
    <path d="M162 340 h100 v30 c0 30 -100 30 -100 0 z" fill="#ffffff" />
    <ellipse cx="360" cy="230" rx="45" ry="60" fill="#ffffff" />
    <path d="M345 280 h30 v110 h-30 z" fill="#ffffff" />
  </svg>
);

function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState("");
  const [dataError, setDataError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  // App Launch Running Animation Splash State (Background data syncs immediately)
  const [showLaunchSplash, setShowLaunchSplash] = useState(true);

  const [orders, setOrders] = useState([]);
  const [restaurants, setRestaurants] = useState([]);
  const [riders, setRiders] = useState([]);
  const [managementEntries, setManagementEntries] = useState([]);
  const [onlineEntries, setOnlineEntries] = useState([]);
  const [locationsData, setLocationsData] = useState([]);
  const [firestorePaperReports, setFirestorePaperReports] = useState([]);
  const [firestoreRiderStatements, setFirestoreRiderStatements] = useState([]);
  const [firestoreRestaurantStatements, setFirestoreRestaurantStatements] = useState([]);

  const [page, setPage] = useState("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [restaurantId, setRestaurantId] = useState("");
  const [riderId, setRiderId] = useState("");
  const [overviewDate, setOverviewDate] = useState(todayKey());
  const [overviewSearch, setOverviewSearch] = useState("");
  const [overviewStatus, setOverviewStatus] = useState("all");

  // Restaurant Page States (Daily + Summary)
  const [restaurantTab, setRestaurantTab] = useState("daily");
  const [resPageDate, setResPageDate] = useState(todayKey());
  const [resPageStatus, setResPageStatus] = useState("all");
  const [resPageSearch, setResPageSearch] = useState("");
  const [resSummaryStart, setResSummaryStart] = useState(todayKey());
  const [resSummaryEnd, setResSummaryEnd] = useState(todayKey());
  // Selection mode for Restaurant Summary: "sell" (Total Sell) OR "physical" (Physical Amount)
  const [resSummaryBaseType, setResSummaryBaseType] = useState("sell");
  const [resAdjAmountInput, setResAdjAmountInput] = useState("");
  const [resAdjNoteInput, setResAdjNoteInput] = useState("");
  const [resFineAmountInput, setResFineAmountInput] = useState("");
  const [resFineNoteInput, setResFineNoteInput] = useState("");
  const [resAdjustments, setResAdjustments] = useState([]);
  const [activeSavedResStatement, setActiveSavedResStatement] = useState(null);

  const [noteModalEntry, setNoteModalEntry] = useState(null);
  const [noteInputVal, setNoteInputVal] = useState("");

  // Rider Page States
  const [riderTab, setRiderTab] = useState("daily");
  const [riderPageDate, setRiderPageDate] = useState(todayKey());
  const [riderPageStatus, setRiderPageStatus] = useState("all");
  const [riderPageSearch, setRiderPageSearch] = useState("");
  const [riderSummaryStart, setRiderSummaryStart] = useState(todayKey());
  const [riderSummaryEnd, setRiderSummaryEnd] = useState(todayKey());

  // Rider Summary Adjustment (Plus / Minus / Fine) & Permanent Statement States
  const [adjAmountInput, setAdjAmountInput] = useState("");
  const [adjNoteInput, setAdjNoteInput] = useState("");
  const [fineAmountInput, setFineAmountInput] = useState("");
  const [fineNoteInput, setFineNoteInput] = useState("");
  const [riderAdjustments, setRiderAdjustments] = useState([]);
  const [activeSavedRiderStatement, setActiveSavedRiderStatement] = useState(null);

  // Full Order Details Modal on Note Long-Press
  const [orderDetailModal, setOrderDetailModal] = useState(null);
  const longPressTimerRef = useRef(null);

  // Bulk Management + Delivery Charge Combined State
  const [bulkDeliveryChargeInput, setBulkDeliveryChargeInput] = useState("0");
  const [bulkSearch, setBulkSearch] = useState("");

  // Check-In Page States
  const [checkInDate, setCheckInDate] = useState(todayKey());
  const [checkInResSearch, setCheckInResSearch] = useState("");
  const [checkInRiderSearch, setCheckInRiderSearch] = useState("");

  const [onlinePayDate, setOnlinePayDate] = useState(todayKey());
  const [onlinePayMethodFilter, setOnlinePayMethodFilter] = useState("all");
  const [onlinePaySearch, setOnlinePaySearch] = useState("");
  const [editModalData, setEditModalData] = useState(null);
  const [editAmountVal, setEditAmountVal] = useState("");
  const [deleteModalData, setDeleteModalData] = useState(null);
  const [savedEntityReports, setSavedEntityReports] = useState(() => {
    try {
      const saved = localStorage.getItem("foodish_saved_entity_reports");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [activeReportPrintData, setActiveReportPrintData] = useState(null);
  const [activePaperworkPrintReport, setActivePaperworkPrintReport] = useState(null);

  // Launch running animation timer (runs smoothly while Firebase auth & data sync in background)
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowLaunchSplash(false);
    }, 1850);
    return () => clearTimeout(timer);
  }, []);

  // UNIVERSAL NATIVE + WEB PRINT / SAVE PDF HELPER
  async function handlePrintReport(title = "Foodish Statement") {
    const previousTitle = document.title;
    const cleanTitle = String(title)
      .replace(/[\\/:*?"<>|]/g, "_")
      .trim();

    document.title = cleanTitle;

    if (Capacitor.getPlatform() !== "web") {
      try {
        await Printer.printWebView({ name: cleanTitle });
      } catch (error) {
        setNotice({ type: "error", text: `Print/PDF failed: ${error.message}` });
      } finally {
        setTimeout(() => {
          document.title = previousTitle;
        }, 1000);
      }
    } else {
      window.print();
      setTimeout(() => {
        document.title = previousTitle;
      }, 1000);
    }
  }

  // UNIVERSAL NATIVE + WEB CSV DOWNLOAD / SHARE HELPER
  async function downloadCsvFile(filename, rawCsvString) {
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    if (Capacitor.getPlatform() !== "web") {
      try {
        const savedFile = await Filesystem.writeFile({
          path: safeFilename,
          data: rawCsvString,
          directory: Directory.Cache,
          encoding: Encoding.UTF8,
        });
        await Share.share({
          title: safeFilename,
          url: savedFile.uri,
          dialogTitle: "Save or Share CSV Report",
        });
      } catch (error) {
        setNotice({ type: "error", text: `CSV download failed: ${error.message}` });
      }
    } else {
      const blob = new Blob([rawCsvString], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", safeFilename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
  }

  useEffect(() => {
    document.title = "Foodish Accounts Dashboard";
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("foodish_saved_entity_reports", JSON.stringify(savedEntityReports));
    } catch (e) {
      console.error(e);
    }
  }, [savedEntityReports]);

  useEffect(() => {
    setRiderAdjustments([]);
    setAdjAmountInput("");
    setAdjNoteInput("");
    setFineAmountInput("");
    setFineNoteInput("");
    setActiveSavedRiderStatement(null);
  }, [riderId, riderSummaryStart, riderSummaryEnd]);

  useEffect(() => {
    setResAdjustments([]);
    setResAdjAmountInput("");
    setResAdjNoteInput("");
    setResFineAmountInput("");
    setResFineNoteInput("");
    setActiveSavedResStatement(null);
  }, [restaurantId, resSummaryStart, resSummaryEnd]);

  const [selectedRestaurantIds, setSelectedRestaurantIds] = useState(() => {
    try {
      const saved = localStorage.getItem("foodish_selected_restaurants");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [paperWorkRiderIds, setPaperWorkRiderIds] = useState(() => {
    try {
      const saved = localStorage.getItem("foodish_paperwork_riders");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [paperWorkDate, setPaperWorkDate] = useState(todayKey());
  const [historyStart, setHistoryStart] = useState(todayKey());
  const [historyEnd, setHistoryEnd] = useState(todayKey());
  const [historyType, setHistoryType] = useState("restaurant");

  useEffect(() => {
    try {
      localStorage.setItem("foodish_selected_restaurants", JSON.stringify(selectedRestaurantIds));
    } catch (e) {
      console.error(e);
    }
  }, [selectedRestaurantIds]);

  useEffect(() => {
    try {
      localStorage.setItem("foodish_paperwork_riders", JSON.stringify(paperWorkRiderIds));
    } catch (e) {
      console.error(e);
    }
  }, [paperWorkRiderIds]);

  // Background Auth & Firestore Sync starts immediately on mount
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setAuthError("");
      if (!currentUser) {
        setUser(null);
        setAuthReady(true);
        return;
      }
      try {
        if (!currentUser.email) throw new Error("Google account email paoya jayni.");
        const adminQuery = query(
          collection(db, COLLECTIONS.admins),
          where("email", "==", currentUser.email.toLowerCase()),
          limit(1)
        );
        const adminSnapshot = await getDocs(adminQuery);
        if (adminSnapshot.empty) {
          await signOut(auth);
          setUser(null);
          setAuthError(`${currentUser.email} admins collection-e anumatito noy.`);
          setAuthReady(true);
          return;
        }
        setUser(currentUser);
        setAuthReady(true);
      } catch (error) {
        setUser(null);
        setAuthError(`Admin verification failed: ${error.message}`);
        setAuthReady(true);
      }
    });
    return unsubscribe;
  }, []);

  async function handleGoogleLogin() {
    setAuthError("");
    try {
      if (Capacitor.getPlatform() !== "web") {
        const result = await FirebaseAuthentication.signInWithGoogle();
        const idToken = result.credential?.idToken;
        if (!idToken) throw new Error("Google ID token paoya jayni.");
        const credential = GoogleAuthProvider.credential(idToken);
        await signInWithCredential(auth, credential);
      } else {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        await signInWithPopup(auth, provider);
      }
    } catch (error) {
      setAuthError(`Google sign-in failed: ${error.message}`);
    }
  }

  async function handleSignOut() {
    try {
      if (Capacitor.getPlatform() !== "web") {
        await FirebaseAuthentication.signOut();
      }
      await signOut(auth);
    } catch (error) {
      setAuthError(`Sign-out failed: ${error.message}`);
    }
  }

  const handleManualRefresh = () => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setNotice({ type: "success", text: "Data successfully refreshed!" });
    }, 600);
  };

  useEffect(() => {
    if (!user) return undefined;
    setLoading(true);
    setDataError("");
    const unsubs = [];
    const subscribe = (name, setter, optional = false) => {
      const q = query(collection(db, name));
      const unsub = onSnapshot(
        q,
        (snapshot) => {
          setter(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
          setLoading(false);
        },
        (error) => {
          if (!optional) {
            setDataError(`${name}: ${error.message}.`);
          }
          setter([]);
          setLoading(false);
        }
      );
      unsubs.push(unsub);
    };

    subscribe(COLLECTIONS.orders, setOrders);
    subscribe(COLLECTIONS.restaurants, setRestaurants);
    subscribe(COLLECTIONS.riders, setRiders);
    subscribe(COLLECTIONS.management, setManagementEntries, true);
    subscribe(COLLECTIONS.online, setOnlineEntries, true);
    subscribe(COLLECTIONS.locations, setLocationsData, true);
    subscribe(COLLECTIONS.paperworkReports, setFirestorePaperReports, true);
    subscribe(COLLECTIONS.riderStatements, setFirestoreRiderStatements, true);
    subscribe(COLLECTIONS.restaurantStatements, setFirestoreRestaurantStatements, true);

    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }, [user]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), 3200);
    return () => clearTimeout(timer);
  }, [notice]);

  const selectedRestaurant =
    restaurants.find((item) => item.id === restaurantId) || restaurants[0];
  const selectedRider = riders.find((item) => item.id === riderId) || riders[0];

  useEffect(() => {
    if (!restaurantId && restaurants.length) setRestaurantId(restaurants[0].id);
  }, [restaurants, restaurantId]);

  useEffect(() => {
    if (!riderId && riders.length) setRiderId(riders[0].id);
  }, [riders, riderId]);

  const startNoteLongPress = (orderObj) => {
    if (!orderObj) return;
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      setOrderDetailModal(orderObj);
    }, 450);
  };

  const cancelNoteLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  async function handleBulkRestaurantAction(turnOn) {
    if (!selectedRestaurantIds.length) {
      setNotice({ type: "error", text: "Prothomay kompokhe ekti restaurant select korun." });
      return;
    }
    const chargeVal = Number(bulkDeliveryChargeInput);
    if (!Number.isFinite(chargeVal) || chargeVal < 0) {
      setNotice({ type: "error", text: "Sothik Delivery Charge din (0 ba tar beshi)." });
      return;
    }

    setSaving(true);
    try {
      let collectedLocations = [];
      if (locationsData && locationsData.length > 0) {
        locationsData.forEach((loc) => {
          const locName = loc.name || loc.id;
          if (locName) collectedLocations.push(locName);
          if (Array.isArray(loc.subLocations)) {
            loc.subLocations.forEach((sub) => {
              if (sub) collectedLocations.push(sub);
            });
          }
        });
      }

      if (collectedLocations.length === 0) {
        restaurants.forEach((r) => {
          if (Array.isArray(r.availableLocations)) {
            r.availableLocations.forEach((loc) => collectedLocations.push(loc));
          } else if (typeof r.availableLocations === "string") {
            collectedLocations.push(r.availableLocations);
          }
        });
      }

      const finalAllLocations = Array.from(new Set(collectedLocations));
      const fallbackList = finalAllLocations.length > 0 ? finalAllLocations : ["Ashulia", "Daffodil Smart City", "Savar"];

      let addedChargeCount = 0;

      const updatePromises = selectedRestaurantIds.map(async (resId) => {
        const resDocRef = doc(db, COLLECTIONS.restaurants, resId);
        const resObj = restaurants.find((r) => r.id === resId);
        const existingCharge = Number(resObj?.hiddenDeliveryCharge ?? 0);

        if (turnOn) {
          const payload = {
            open: "yes",
            priority: 0,
            availableLocations: fallbackList,
          };
          if (existingCharge === 0 && chargeVal > 0) {
            payload.hiddenDeliveryCharge = chargeVal;
            payload.hiddenDeliveryChargeUpdatedAt = serverTimestamp();
            addedChargeCount += 1;
          }
          await updateDoc(resDocRef, payload);
        } else {
          await updateDoc(resDocRef, {
            open: "no",
            priority: 1000,
          });
        }
      });

      await Promise.all(updatePromises);
      setNotice({
        type: "success",
        text: turnOn
          ? `Selected restaurant-gula open hoiche, priority 0, all locations select kora hoiche${
              addedChargeCount > 0 ? ` ebong ${addedChargeCount}ti 0-charge restaurant-e ${money(chargeVal)} delivery charge add hoiche!` : "!"
            }`
          : "Selected restaurant-gula off hoiche ebong priority 1000 kora hoiche.",
      });
    } catch (error) {
      setNotice({ type: "error", text: `Action failed: ${error.message}` });
    } finally {
      setSaving(false);
    }
  }

  async function handleBulkSaveDeliveryCharge(event) {
    event.preventDefault();
    if (!selectedRestaurantIds.length) {
      setNotice({ type: "error", text: "Prothomay kompokhe ekti restaurant select korun." });
      return;
    }
    const chargeVal = Number(bulkDeliveryChargeInput);
    if (!Number.isFinite(chargeVal) || chargeVal < 0) {
      setNotice({ type: "error", text: "Sothik Delivery Charge din (0 ba tar beshi)." });
      return;
    }

    setSaving(true);
    try {
      await Promise.all(
        selectedRestaurantIds.map((resId) =>
          updateDoc(doc(db, COLLECTIONS.restaurants, resId), {
            hiddenDeliveryCharge: chargeVal,
            hiddenDeliveryChargeUpdatedAt: serverTimestamp(),
          })
        )
      );
      setNotice({
        type: "success",
        text: `${selectedRestaurantIds.length}ti selected restaurant-er delivery charge ${money(chargeVal)} save kora hoiche!`,
      });
    } catch (error) {
      setNotice({ type: "error", text: `Charge save failed: ${error.message}` });
    } finally {
      setSaving(false);
    }
  }

  const toggleRestaurantSelection = (id) => {
    setSelectedRestaurantIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const selectAllRestaurants = () => setSelectedRestaurantIds(restaurants.map((r) => r.id));
  const clearSelectedRestaurants = () => setSelectedRestaurantIds([]);

  const togglePaperWorkRider = (id) => {
    setPaperWorkRiderIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const selectAllPaperWorkRiders = () => setPaperWorkRiderIds(riders.map((r) => r.id));
  const clearPaperWorkRiders = () => setPaperWorkRiderIds([]);

  async function handleUpdateManagementEntry({ entityType, entityId, entityName, type, amount, note, date }) {
    setSaving(true);
    try {
      const existingEntry = managementEntries.find(
        (entry) =>
          entry.entityType === entityType &&
          String(entry.entityId) === String(entityId) &&
          dateKey(entry.date || entry.createdAt) === date &&
          normalized(entry.type) === normalized(type)
      );

      const payload = {
        entityType,
        entityId,
        entityName,
        type,
        amount: Number(amount || 0),
        note: note !== undefined ? note : (existingEntry?.note || ""),
        date,
        updatedAt: serverTimestamp(),
      };

      if (existingEntry) {
        await updateDoc(doc(db, COLLECTIONS.management, existingEntry.id), payload);
      } else {
        await addDoc(collection(db, COLLECTIONS.management), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }
      setNotice({ type: "success", text: "Successfully updated." });
    } catch (error) {
      setNotice({ type: "error", text: `Update failed: ${error.message}` });
    } finally {
      setSaving(false);
    }
  }

  const ridersWithBill = useMemo(() => {
    return riders
      .map((r) => {
        const riderOrders = orders.filter((o) => {
          return (
            String(o.riderId || "") === String(r.id) &&
            dateKey(o.createdAt) === paperWorkDate &&
            isDelivered(o)
          );
        });
        const bill = riderOrders.reduce((sum, o) => sum + itemSubtotal(o.items), 0);
        return { ...r, calculatedBill: bill };
      })
      .sort((a, b) => b.calculatedBill - a.calculatedBill);
  }, [riders, orders, paperWorkDate]);

  const paperWorkTableRows = useMemo(() => {
    return paperWorkRiderIds.map((rId) => {
      const riderObj = riders.find((r) => r.id === rId);
      const riderName = riderObj ? riderObj.name : rId;

      const riderOrdersOnDate = orders.filter((o) => {
        const matchesRider = String(o.riderId || "") === String(rId);
        const matchesDate = dateKey(o.createdAt) === paperWorkDate;
        const matchesDelivered = isDelivered(o);
        return matchesRider && matchesDate && matchesDelivered;
      });

      const deliveredCount = riderOrdersOnDate.length;

      const onlineAmount = riderOrdersOnDate
        .filter((o) => !isCOD(o))
        .reduce((sum, o) => sum + orderAmount(o), 0);

      const billAmount = riderOrdersOnDate.reduce((sum, o) => {
        return sum + itemSubtotal(o.items);
      }, 0);

      const totalOrderAmount = riderOrdersOnDate.reduce((sum, o) => sum + orderAmount(o), 0);
      const chargeAmount = totalOrderAmount - billAmount;

      const riderEntries = managementEntries.filter(
        (e) =>
          e.entityType === "rider" &&
          String(e.entityId) === String(rId) &&
          dateKey(e.date || e.createdAt) === paperWorkDate
      );

      const collectAmount = riderEntries
        .filter((e) => ["collection", "physical"].includes(normalized(e.type)))
        .reduce((sum, e) => sum + Number(e.amount || 0), 0);

      const salaryEntry = riderEntries.find((e) => normalized(e.type) === "salary");
      const salaryAmount = salaryEntry ? Number(salaryEntry.amount || 0) : 0;

      const fineAmount = riderEntries
        .filter((e) => normalized(e.type) === "fine")
        .reduce((sum, e) => sum + Number(e.amount || 0), 0);

      return {
        riderId: rId,
        name: riderName,
        delivered: deliveredCount,
        online: onlineAmount,
        bill: billAmount,
        charge: chargeAmount,
        collect: collectAmount,
        salary: salaryAmount,
        fine: fineAmount,
      };
    });
  }, [paperWorkRiderIds, paperWorkDate, orders, riders, managementEntries]);

  const paperWorkTotals = useMemo(() => {
    return paperWorkTableRows.reduce(
      (acc, row) => ({
        delivered: acc.delivered + row.delivered,
        online: acc.online + row.online,
        bill: acc.bill + row.bill,
        charge: acc.charge + row.charge,
        collect: acc.collect + row.collect,
        salary: acc.salary + row.salary,
        fine: acc.fine + row.fine,
      }),
      { delivered: 0, online: 0, bill: 0, charge: 0, collect: 0, salary: 0, fine: 0 }
    );
  }, [paperWorkTableRows]);

  const calculatedProfit = useMemo(() => {
    return paperWorkTotals.bill * 0.0941 + paperWorkTotals.charge;
  }, [paperWorkTotals]);

  async function saveCurrentPaperWorkReport() {
    setSaving(true);
    try {
      const reportData = {
        date: paperWorkDate,
        savedAt: new Date().toISOString(),
        rows: JSON.parse(JSON.stringify(paperWorkTableRows)),
        totals: { ...paperWorkTotals },
        profit: calculatedProfit,
      };

      const existing = firestorePaperReports.find((r) => r.date === paperWorkDate);
      if (existing) {
        await updateDoc(doc(db, COLLECTIONS.paperworkReports, existing.id), reportData);
      } else {
        await addDoc(collection(db, COLLECTIONS.paperworkReports), reportData);
      }

      setNotice({ type: "success", text: `Paper Work report for ${paperWorkDate} permanently saved!` });
    } catch (error) {
      setNotice({ type: "error", text: `Save failed: ${error.message}` });
    } finally {
      setSaving(false);
    }
  }

  const deleteSavedReport = (reportId) => {
    setDeleteModalData({
      title: "Delete Saved Report",
      message: "Are you sure you want to delete this saved report?",
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, COLLECTIONS.paperworkReports, reportId));
          setNotice({ type: "success", text: "Saved report deleted successfully." });
        } catch (error) {
          setNotice({ type: "error", text: `Delete failed: ${error.message}` });
        }
      },
    });
  };

  const downloadSavedReportCSV = (report) => {
    let csvContent = `Paper Work Report - Date: ${report.date}\n\n`;
    csvContent += "Name,Delivered,Online,Bill,Charge,Salary,Fine\n";
    report.rows.forEach((r) => {
      csvContent += `"${r.name}",${r.delivered},${r.online},${r.bill},${r.charge},${r.salary},${r.fine}\n`;
    });

    csvContent += `\nAll Total,,${report.totals.online},${report.totals.bill},${report.totals.charge},${report.totals.salary},${report.totals.fine}\n`;
    csvContent += `\nProfit Summary (Formula: Bill*9.41% + Charge),,${report.profit}\n`;

    downloadCsvFile(`paper_work_report_${report.date}.csv`, csvContent);
  };

  const overviewOrdersOnDate = useMemo(
    () => orders.filter((order) => dateKey(order.createdAt) === overviewDate),
    [orders, overviewDate]
  );

  const overviewFilteredOrders = useMemo(() => {
    return overviewOrdersOnDate
      .filter((order) => {
        const status = normalized(order.orderStatus);
        if (overviewStatus === "delivered" && !isDelivered(order)) return false;
        if (overviewStatus === "cancelled" && !isCancelled(order)) return false;
        if (overviewStatus === "pending" && !["pending", "processing", "accepted"].includes(status)) return false;
        if (overviewStatus === "on_the_way" && !["on the way", "ontheway", "picked up", "dispatched"].includes(status)) return false;

        if (!overviewSearch) return true;
        const s = normalized(overviewSearch);
        const orderIdStr = normalized(order.orderId || order.id);
        const userName = normalized(order.userName);
        const userPhone = normalized(order.userPhone);
        const restaurantNames = normalized(getOrderRestaurants(order.items));

        return (
          orderIdStr.includes(s) ||
          userName.includes(s) ||
          userPhone.includes(s) ||
          restaurantNames.includes(s)
        );
      })
      .sort((a, b) => (asDate(b.createdAt)?.getTime() || 0) - (asDate(a.createdAt)?.getTime() || 0));
  }, [overviewOrdersOnDate, overviewSearch, overviewStatus]);

  const deliveredOverview = overviewOrdersOnDate.filter(isDelivered);
  const cancelledOverview = overviewOrdersOnDate.filter(isCancelled);
  const deliveredTotalOverview = deliveredOverview.reduce((sum, order) => sum + orderAmount(order), 0);
  const cancelledTotalOverview = cancelledOverview.reduce((sum, order) => sum + orderAmount(order), 0);
  const codTotalOverview = deliveredOverview
    .filter(isCOD)
    .reduce((sum, order) => sum + orderAmount(order), 0);

  const restaurantPageOrders = useMemo(() => {
    if (!selectedRestaurant) return [];
    return orders
      .filter((order) => {
        const matchesDate = dateKey(order.createdAt) === resPageDate;
        const subtotal = itemSubtotal(order.items, selectedRestaurant.name, selectedRestaurant.id);
        if (!matchesDate || subtotal <= 0) return false;

        const status = normalized(order.orderStatus);
        if (resPageStatus === "delivered" && !isDelivered(order)) return false;
        if (resPageStatus === "cancelled" && !isCancelled(order)) return false;
        if (resPageStatus === "pending" && !["pending", "processing", "accepted"].includes(status)) return false;
        if (resPageStatus === "on_the_way" && !["on the way", "ontheway", "picked up", "dispatched"].includes(status)) return false;

        if (!resPageSearch) return true;
        const s = normalized(resPageSearch);
        const orderIdStr = normalized(order.orderId || order.id);
        const userName = normalized(order.userName);
        const userPhone = normalized(order.userPhone);

        return orderIdStr.includes(s) || userName.includes(s) || userPhone.includes(s);
      })
      .map((order) => {
        return {
          ...order,
          restaurantSubtotal: itemSubtotal(order.items, selectedRestaurant.name, selectedRestaurant.id),
        };
      })
      .sort((a, b) => (asDate(b.createdAt)?.getTime() || 0) - (asDate(a.createdAt)?.getTime() || 0));
  }, [orders, selectedRestaurant, resPageDate, resPageStatus, resPageSearch]);

  const restaurantPageStats = useMemo(() => {
    if (!selectedRestaurant) return { deliveredTotal: 0, pendingTotal: 0, cancelledTotal: 0 };
    const allResOrdersOnDate = orders.filter((order) => {
      return (
        dateKey(order.createdAt) === resPageDate &&
        itemSubtotal(order.items, selectedRestaurant.name, selectedRestaurant.id) > 0
      );
    });

    let deliveredSum = 0;
    let pendingSum = 0;
    let cancelledSum = 0;

    allResOrdersOnDate.forEach((order) => {
      const sub = itemSubtotal(order.items, selectedRestaurant.name, selectedRestaurant.id);
      if (isDelivered(order)) {
        deliveredSum += sub;
      } else if (isCancelled(order)) {
        cancelledSum += sub;
      } else {
        pendingSum += sub;
      }
    });

    return { deliveredTotal: deliveredSum, pendingTotal: pendingSum, cancelledTotal: cancelledSum };
  }, [orders, selectedRestaurant, resPageDate]);

  // Restaurant Range Summary: calculates BOTH Total Sell (deliveredSubtotal) AND Physical Cash Amount
  const restaurantRangeSummary = useMemo(() => {
    if (!selectedRestaurant || !resSummaryStart || !resSummaryEnd) {
      return {
        deliveredSubtotal: 0,
        physicalTotal: 0,
        deliveredCount: 0,
        orderNotesList: [],
      };
    }

    let deliveredSubtotal = 0;
    let deliveredCount = 0;
    const orderNotesList = [];

    orders.forEach((order) => {
      const k = dateKey(order.createdAt);
      if (!k || k < resSummaryStart || k > resSummaryEnd) return;

      const sub = itemSubtotal(order.items, selectedRestaurant.name, selectedRestaurant.id);
      if (sub <= 0) return;

      if (isDelivered(order)) {
        deliveredCount += 1;
        deliveredSubtotal += sub;
      }

      const rawOrderNote = order.note || order.orderNote || order.instructions || "";
      if (String(rawOrderNote).trim() !== "") {
        const matchedRider = riders.find((r) => String(r.id) === String(order.riderId));
        orderNotesList.push({
          id: order.id,
          date: k,
          createdAt: order.createdAt,
          createdAtFormatted: formatDateTime(order.createdAt),
          orderId: order.orderId || order.id.slice(0, 8),
          status: order.orderStatus || "Pending",
          isDelivered: isDelivered(order),
          isCancelled: isCancelled(order),
          note: String(rawOrderNote).trim(),
          amount: orderAmount(order),
          restaurantSubtotal: sub,
          payment: order.payment || order.paymentMethod || "—",
          userName: order.userName || "—",
          userPhone: order.userPhone || "—",
          userAddress: order.address || order.userAddress || order.deliveryAddress || "",
          riderName: matchedRider ? matchedRider.name || matchedRider.id : order.riderName || "—",
          riderPhone: matchedRider ? matchedRider.phone || "—" : order.riderPhone || "—",
          items: Array.isArray(order.items) ? JSON.parse(JSON.stringify(order.items)) : [],
        });
      }
    });

    // Sum physical cash collection entries for this restaurant across the selected date range
    let physicalTotal = 0;
    managementEntries.forEach((entry) => {
      const k = dateKey(entry.date || entry.createdAt);
      if (
        k &&
        k >= resSummaryStart &&
        k <= resSummaryEnd &&
        entry.entityType === "restaurant" &&
        String(entry.entityId) === String(selectedRestaurant.id) &&
        ["collection", "physical"].includes(normalized(entry.type))
      ) {
        physicalTotal += Number(entry.amount || 0);
      }
    });

    orderNotesList.sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (asDate(a.createdAt)?.getTime() || 0) - (asDate(b.createdAt)?.getTime() || 0)
    );

    return {
      deliveredSubtotal,
      physicalTotal,
      deliveredCount,
      orderNotesList,
    };
  }, [orders, riders, managementEntries, selectedRestaurant, resSummaryStart, resSummaryEnd]);

  const handleAddRestaurantAdjustment = (type) => {
    const isFine = type === "fine";
    const rawVal = isFine ? resFineAmountInput : resAdjAmountInput;
    const rawNote = isFine ? resFineNoteInput : resAdjNoteInput;
    const numericVal = Number(rawVal);

    if (!rawVal || !Number.isFinite(numericVal) || numericVal <= 0) {
      setNotice({ type: "error", text: "Sothik amount din (0-er beshi)." });
      return;
    }

    const newEntry = {
      id: `res-adj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      amount: numericVal,
      note: String(rawNote || "").trim() || (type === "plus" ? "Added (+)" : type === "minus" ? "Deducted (-)" : "Fine (-)"),
      addedAt: new Date().toISOString(),
    };

    setResAdjustments((prev) => [...prev, newEntry]);
    if (isFine) {
      setResFineAmountInput("");
      setResFineNoteInput("");
    } else {
      setResAdjAmountInput("");
      setResAdjNoteInput("");
    }
    setNotice({
      type: "success",
      text: `${type === "plus" ? "+ Plus" : type === "minus" ? "- Minus" : "Fine"} (${money(numericVal)}) added!`,
    });
  };

  const handleRemoveRestaurantAdjustment = (adjId) => {
    setResAdjustments((prev) => prev.filter((item) => item.id !== adjId));
  };

  const resSummaryCalculation = useMemo(() => {
    const baseTotal =
      resSummaryBaseType === "physical"
        ? Number(restaurantRangeSummary.physicalTotal || 0)
        : Number(restaurantRangeSummary.deliveredSubtotal || 0);

    let plusSum = 0;
    let minusSum = 0;
    let fineSum = 0;

    resAdjustments.forEach((adj) => {
      if (adj.type === "plus") plusSum += Number(adj.amount || 0);
      if (adj.type === "minus") minusSum += Number(adj.amount || 0);
      if (adj.type === "fine") fineSum += Number(adj.amount || 0);
    });

    const netTotal = baseTotal + plusSum - minusSum - fineSum;
    return { baseTotal, plusSum, minusSum, fineSum, netTotal };
  }, [restaurantRangeSummary, resAdjustments, resSummaryBaseType]);

  async function saveRestaurantStatementToDatabase() {
    if (!selectedRestaurant) {
      setNotice({ type: "error", text: "Restaurant select korun." });
      return;
    }
    const baseLabel =
      resSummaryBaseType === "physical"
        ? "Physical Cash Amount"
        : "Total Sell (Delivered Items)";

    setSaving(true);
    try {
      const statementPayload = {
        restaurantId: selectedRestaurant.id,
        restaurantName: selectedRestaurant.name || selectedRestaurant.id,
        fromDate: resSummaryStart,
        toDate: resSummaryEnd,
        savedAt: new Date().toISOString(),
        deliveredCount: restaurantRangeSummary.deliveredCount,
        baseType: resSummaryBaseType,
        baseLabel,
        baseTotal: resSummaryCalculation.baseTotal,
        plusSum: resSummaryCalculation.plusSum,
        minusSum: resSummaryCalculation.minusSum,
        fineSum: resSummaryCalculation.fineSum,
        netTotal: resSummaryCalculation.netTotal,
        adjustments: JSON.parse(JSON.stringify(resAdjustments)),
        orderNotes: JSON.parse(JSON.stringify(restaurantRangeSummary.orderNotesList)),
        locked: true,
      };

      const docRef = await addDoc(collection(db, COLLECTIONS.restaurantStatements), statementPayload);
      setActiveSavedResStatement({ id: docRef.id, ...statementPayload });
      setNotice({
        type: "success",
        text: `Statement permanently saved for ${selectedRestaurant.name} (${resSummaryStart} to ${resSummaryEnd})!`,
      });
    } catch (error) {
      setNotice({ type: "error", text: `Save failed: ${error.message}` });
    } finally {
      setSaving(false);
    }
  }

  const deleteSavedRestaurantStatement = (statementId) => {
    setDeleteModalData({
      title: "Delete Saved Restaurant Statement",
      message: "Are you sure you want to permanently delete this saved restaurant statement?",
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, COLLECTIONS.restaurantStatements, statementId));
          if (activeSavedResStatement?.id === statementId) {
            setActiveSavedResStatement(null);
          }
          setNotice({ type: "success", text: "Saved restaurant statement deleted successfully." });
        } catch (error) {
          setNotice({ type: "error", text: `Delete failed: ${error.message}` });
        }
      },
    });
  };

  const downloadRestaurantStatementCSV = (st) => {
    const labelText =
      st.baseLabel ||
      (st.baseType === "physical" ? "Physical Cash Amount" : "Total Sell (Delivered Items)");
    let csvContent = `FOODISH RESTAURANT STATEMENT\n`;
    csvContent += `Restaurant Name:,"${st.restaurantName}"\n`;
    csvContent += `Period:,${st.fromDate} to ${st.toDate}\n`;
    csvContent += `${labelText}:,${st.baseTotal}\n\n`;
    csvContent += `SL,Type,Amount,Note\n`;
    (st.adjustments || []).forEach((adj, idx) => {
      const sign = adj.type === "plus" ? "+ Plus" : adj.type === "minus" ? "- Minus" : "Fine (-)";
      csvContent += `${idx + 1},"${sign}",${adj.amount},"${(adj.note || "").replace(/"/g, '""')}"\n`;
    });
    csvContent += `\nNet Final Payable Total:,${st.netTotal}\n\n`;
    csvContent += `ORDER NOTES LIST\n`;
    csvContent += `SL,Date,Order ID,Status,Order Note\n`;
    (st.orderNotes || []).forEach((n, idx) => {
      csvContent += `${idx + 1},${n.date},"#${n.orderId}","${n.status}","${(n.note || "").replace(/"/g, '""')}"\n`;
    });

    downloadCsvFile(`restaurant_statement_${st.restaurantName}_${st.fromDate}_to_${st.toDate}.csv`, csvContent);
  };

  const riderPageOrders = useMemo(() => {
    if (!selectedRider) return [];
    return orders
      .filter((order) => {
        const matchesDate = dateKey(order.createdAt) === riderPageDate;
        const matchesRider = String(order.riderId || "") === String(selectedRider.id);
        if (!matchesDate || !matchesRider) return false;

        const status = normalized(order.orderStatus);
        if (riderPageStatus === "delivered" && !isDelivered(order)) return false;
        if (riderPageStatus === "cancelled" && !isCancelled(order)) return false;
        if (riderPageStatus === "pending" && !["pending", "processing", "accepted"].includes(status)) return false;
        if (riderPageStatus === "on_the_way" && !["on the way", "ontheway", "picked up", "dispatched"].includes(status)) return false;

        if (!riderPageSearch) return true;
        const s = normalized(riderPageSearch);
        const orderIdStr = normalized(order.orderId || order.id);
        const userName = normalized(order.userName);
        const userPhone = normalized(order.userPhone);
        const restNames = normalized(getOrderRestaurants(order.items));

        return orderIdStr.includes(s) || userName.includes(s) || userPhone.includes(s) || restNames.includes(s);
      })
      .sort((a, b) => (asDate(b.createdAt)?.getTime() || 0) - (asDate(a.createdAt)?.getTime() || 0));
  }, [orders, selectedRider, riderPageDate, riderPageStatus, riderPageSearch]);

  const riderPageStats = useMemo(() => {
    if (!selectedRider) {
      return {
        deliveredTotal: 0,
        deliveredCod: 0,
        deliveredOnline: 0,
        pendingTotal: 0,
        cancelledTotal: 0,
        totalOrdersAmount: 0,
        totalProductAmount: 0,
        totalCharge: 0,
      };
    }
    const allRiderOrdersOnDate = orders.filter((order) => {
      return dateKey(order.createdAt) === riderPageDate && String(order.riderId || "") === String(selectedRider.id);
    });

    let deliveredCodSum = 0;
    let deliveredOnlineSum = 0;
    let pendingSum = 0;
    let cancelledSum = 0;
    let totalOrdersAmt = 0;
    let totalProductAmt = 0;

    allRiderOrdersOnDate.forEach((order) => {
      const amt = orderAmount(order);
      const prodAmt = itemSubtotal(order.items);

      if (isDelivered(order)) {
        totalOrdersAmt += amt;
        totalProductAmt += prodAmt;

        if (isCOD(order)) {
          deliveredCodSum += amt;
        } else {
          deliveredOnlineSum += amt;
        }
      } else if (isCancelled(order)) {
        cancelledSum += amt;
      } else {
        pendingSum += amt;
      }
    });

    const totalDelivered = deliveredCodSum + deliveredOnlineSum;
    const charge = Math.max(0, totalOrdersAmt - totalProductAmt);

    return {
      deliveredTotal: totalDelivered,
      deliveredCod: deliveredCodSum,
      deliveredOnline: deliveredOnlineSum,
      pendingTotal: pendingSum,
      cancelledTotal: cancelledSum,
      totalOrdersAmount: totalOrdersAmt,
      totalProductAmount: totalProductAmt,
      totalCharge: charge,
    };
  }, [orders, selectedRider, riderPageDate]);

  const riderRangeSummary = useMemo(() => {
    if (!selectedRider || !riderSummaryStart || !riderSummaryEnd) {
      return {
        deliveredCod: 0,
        deliveredCount: 0,
        orderNotesList: [],
      };
    }

    let deliveredCod = 0;
    let deliveredCount = 0;
    const orderNotesList = [];

    orders.forEach((order) => {
      const k = dateKey(order.createdAt);
      if (!k || k < riderSummaryStart || k > riderSummaryEnd) return;
      if (String(order.riderId || "") !== String(selectedRider.id)) return;

      const amt = orderAmount(order);

      if (isDelivered(order) && isCOD(order)) {
        deliveredCount += 1;
        deliveredCod += amt;
      }

      const rawOrderNote = order.note || order.orderNote || order.instructions || "";
      if (String(rawOrderNote).trim() !== "") {
        orderNotesList.push({
          id: order.id,
          date: k,
          createdAt: order.createdAt,
          createdAtFormatted: formatDateTime(order.createdAt),
          orderId: order.orderId || order.id.slice(0, 8),
          status: order.orderStatus || "Pending",
          isDelivered: isDelivered(order),
          isCancelled: isCancelled(order),
          note: String(rawOrderNote).trim(),
          amount: amt,
          payment: order.payment || order.paymentMethod || "—",
          userName: order.userName || "—",
          userPhone: order.userPhone || "—",
          userAddress: order.address || order.userAddress || order.deliveryAddress || "",
          riderName: selectedRider?.name || order.riderName || "—",
          riderPhone: selectedRider?.phone || order.riderPhone || "—",
          items: Array.isArray(order.items) ? JSON.parse(JSON.stringify(order.items)) : [],
        });
      }
    });

    orderNotesList.sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (asDate(a.createdAt)?.getTime() || 0) - (asDate(b.createdAt)?.getTime() || 0)
    );

    return {
      deliveredCod,
      deliveredCount,
      orderNotesList,
    };
  }, [orders, selectedRider, riderSummaryStart, riderSummaryEnd]);

  const handleAddRiderAdjustment = (type) => {
    const isFine = type === "fine";
    const rawVal = isFine ? fineAmountInput : adjAmountInput;
    const rawNote = isFine ? fineNoteInput : adjNoteInput;
    const numericVal = Number(rawVal);

    if (!rawVal || !Number.isFinite(numericVal) || numericVal <= 0) {
      setNotice({ type: "error", text: "Sothik amount din (0-er beshi)." });
      return;
    }

    const newEntry = {
      id: `adj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      amount: numericVal,
      note: String(rawNote || "").trim() || (type === "plus" ? "Added (+)" : type === "minus" ? "Deducted (-)" : "Fine (-)"),
      addedAt: new Date().toISOString(),
    };

    setRiderAdjustments((prev) => [...prev, newEntry]);
    if (isFine) {
      setFineAmountInput("");
      setFineNoteInput("");
    } else {
      setAdjAmountInput("");
      setAdjNoteInput("");
    }
    setNotice({
      type: "success",
      text: `${type === "plus" ? "+ Plus" : type === "minus" ? "- Minus" : "Fine"} (${money(numericVal)}) added!`,
    });
  };

  const handleRemoveRiderAdjustment = (adjId) => {
    setRiderAdjustments((prev) => prev.filter((item) => item.id !== adjId));
  };

  const riderSummaryCalculation = useMemo(() => {
    const baseTotal = Number(riderRangeSummary.deliveredCod || 0);

    let plusSum = 0;
    let minusSum = 0;
    let fineSum = 0;

    riderAdjustments.forEach((adj) => {
      if (adj.type === "plus") plusSum += Number(adj.amount || 0);
      if (adj.type === "minus") minusSum += Number(adj.amount || 0);
      if (adj.type === "fine") fineSum += Number(adj.amount || 0);
    });

    const netTotal = baseTotal + plusSum - minusSum - fineSum;

    return {
      baseTotal,
      plusSum,
      minusSum,
      fineSum,
      netTotal,
    };
  }, [riderRangeSummary, riderAdjustments]);

  async function saveRiderStatementToDatabase() {
    if (!selectedRider) {
      setNotice({ type: "error", text: "Rider select korun." });
      return;
    }
    setSaving(true);
    try {
      const statementPayload = {
        riderId: selectedRider.id,
        riderName: selectedRider.name || selectedRider.id,
        riderPhone: selectedRider.phone || "",
        fromDate: riderSummaryStart,
        toDate: riderSummaryEnd,
        savedAt: new Date().toISOString(),
        deliveredCount: riderRangeSummary.deliveredCount,
        baseTotal: riderSummaryCalculation.baseTotal,
        plusSum: riderSummaryCalculation.plusSum,
        minusSum: riderSummaryCalculation.minusSum,
        fineSum: riderSummaryCalculation.fineSum,
        netTotal: riderSummaryCalculation.netTotal,
        adjustments: JSON.parse(JSON.stringify(riderAdjustments)),
        orderNotes: JSON.parse(JSON.stringify(riderRangeSummary.orderNotesList)),
        locked: true,
      };

      const docRef = await addDoc(collection(db, COLLECTIONS.riderStatements), statementPayload);
      setActiveSavedRiderStatement({ id: docRef.id, ...statementPayload });
      setNotice({
        type: "success",
        text: `Statement permanently saved for ${selectedRider.name} (${riderSummaryStart} to ${riderSummaryEnd})!`,
      });
    } catch (error) {
      setNotice({ type: "error", text: `Save failed: ${error.message}` });
    } finally {
      setSaving(false);
    }
  }

  const deleteSavedRiderStatement = (statementId) => {
    setDeleteModalData({
      title: "Delete Saved Rider Statement",
      message: "Are you sure you want to permanently delete this saved rider statement?",
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, COLLECTIONS.riderStatements, statementId));
          if (activeSavedRiderStatement?.id === statementId) {
            setActiveSavedRiderStatement(null);
          }
          setNotice({ type: "success", text: "Saved rider statement deleted successfully." });
        } catch (error) {
          setNotice({ type: "error", text: `Delete failed: ${error.message}` });
        }
      },
    });
  };

  const downloadRiderStatementCSV = (st) => {
    let csvContent = `FOODISH RIDER STATEMENT\n`;
    csvContent += `Rider Name:,"${st.riderName}"\n`;
    csvContent += `Period:,${st.fromDate} to ${st.toDate}\n`;
    csvContent += `Total COD Cash Amount:,${st.baseTotal}\n\n`;
    csvContent += `SL,Type,Amount,Note\n`;
    (st.adjustments || []).forEach((adj, idx) => {
      const sign = adj.type === "plus" ? "+ Plus" : adj.type === "minus" ? "- Minus" : "Fine (-)";
      csvContent += `${idx + 1},"${sign}",${adj.amount},"${(adj.note || "").replace(/"/g, '""')}"\n`;
    });
    csvContent += `\nNet Final COD Cash Total:,${st.netTotal}\n\n`;
    csvContent += `ORDER NOTES LIST\n`;
    csvContent += `SL,Date,Order ID,Status,Order Note\n`;
    (st.orderNotes || []).forEach((n, idx) => {
      csvContent += `${idx + 1},${n.date},"#${n.orderId}","${n.status}","${(n.note || "").replace(/"/g, '""')}"\n`;
    });

    downloadCsvFile(`rider_statement_${st.riderName}_${st.fromDate}_to_${st.toDate}.csv`, csvContent);
  };

  const onlinePaymentOrders = useMemo(() => {
    return orders
      .filter((order) => {
        const matchesDate = dateKey(order.createdAt) === onlinePayDate;
        const notCOD = !isCOD(order);
        if (!matchesDate || !notCOD) return false;

        if (onlinePayMethodFilter !== "all") {
          const payMethod = normalized(order.payment || order.paymentMethod);
          if (!payMethod.includes(normalized(onlinePayMethodFilter))) return false;
        }

        if (!onlinePaySearch) return true;
        const s = normalized(onlinePaySearch);
        const orderIdStr = normalized(order.orderId || order.id);
        const userName = normalized(order.userName);
        const userPhone = normalized(order.userPhone);
        const trxId = normalized(order.trxId || order.transactionId || order.paymentTrxId || "");

        return orderIdStr.includes(s) || userName.includes(s) || userPhone.includes(s) || trxId.includes(s);
      })
      .sort((a, b) => (asDate(b.createdAt)?.getTime() || 0) - (asDate(a.createdAt)?.getTime() || 0));
  }, [orders, onlinePayDate, onlinePayMethodFilter, onlinePaySearch]);

  const onlinePaymentTotals = useMemo(() => {
    let bkashSum = 0;
    let nagadSum = 0;
    let rocketSum = 0;
    let otherSum = 0;

    onlinePaymentOrders.forEach((o) => {
      const method = normalized(o.payment || o.paymentMethod);
      const amt = orderAmount(o);
      if (method.includes("bkash")) bkashSum += amt;
      else if (method.includes("nagad")) nagadSum += amt;
      else if (method.includes("rocket")) rocketSum += amt;
      else otherSum += amt;
    });

    return {
      bkash: bkashSum,
      nagad: nagadSum,
      rocket: rocketSum,
      other: otherSum,
      total: bkashSum + nagadSum + rocketSum + otherSum,
    };
  }, [onlinePaymentOrders]);

  const restaurantPhysicalEntry = managementEntries.find(
    (e) =>
      e.entityType === "restaurant" &&
      String(e.entityId) === String(restaurantId) &&
      dateKey(e.date || e.createdAt) === resPageDate &&
      ["collection", "physical"].includes(normalized(e.type))
  );

  const restaurantCheckedEntry = managementEntries.find(
    (e) =>
      e.entityType === "restaurant" &&
      String(e.entityId) === String(restaurantId) &&
      dateKey(e.date || e.createdAt) === resPageDate &&
      normalized(e.type) === "restaurant_checked"
  );
  const isRestaurantChecked = Number(restaurantCheckedEntry?.amount || 0) === 1;

  async function handleToggleRestaurantCheck(nextChecked) {
    if (!restaurantId) return;
    const resName = selectedRestaurant?.name || "Restaurant";
    const autoSum =
      Number(restaurantPageStats.deliveredTotal || 0) +
      Number(restaurantPageStats.pendingTotal || 0);

    await handleUpdateManagementEntry({
      entityType: "restaurant",
      entityId: restaurantId,
      entityName: resName,
      type: "restaurant_checked",
      amount: nextChecked ? 1 : 0,
      date: resPageDate,
    });

    if (nextChecked) {
      await handleUpdateManagementEntry({
        entityType: "restaurant",
        entityId: restaurantId,
        entityName: resName,
        type: "physical",
        amount: autoSum,
        date: resPageDate,
      });
      setNotice({
        type: "success",
        text: `Checked! Physical amount auto-saved as ${money(autoSum)} (Delivered + Pending).`,
      });
    } else {
      setNotice({
        type: "success",
        text: "Unchecked! Now you can enter Physical amount manually and save.",
      });
    }
  }

  const riderCollectionEntry = managementEntries.find(
    (e) =>
      e.entityType === "rider" &&
      String(e.entityId) === String(riderId) &&
      dateKey(e.date || e.createdAt) === riderPageDate &&
      ["collection", "physical"].includes(normalized(e.type))
  );

  const riderBkashEntry = managementEntries.find(
    (e) =>
      e.entityType === "rider" &&
      String(e.entityId) === String(riderId) &&
      dateKey(e.date || e.createdAt) === riderPageDate &&
      normalized(e.type) === "bkash"
  );

  const riderNagadEntry = managementEntries.find(
    (e) =>
      e.entityType === "rider" &&
      String(e.entityId) === String(riderId) &&
      dateKey(e.date || e.createdAt) === riderPageDate &&
      normalized(e.type) === "nagad"
  );

  const riderFineEntry = managementEntries.find(
    (e) =>
      e.entityType === "rider" &&
      String(e.entityId) === String(riderId) &&
      dateKey(e.date || e.createdAt) === riderPageDate &&
      normalized(e.type) === "fine"
  );

  const riderSalaryEntry = managementEntries.find(
    (e) =>
      e.entityType === "rider" &&
      String(e.entityId) === String(riderId) &&
      dateKey(e.date || e.createdAt) === riderPageDate &&
      normalized(e.type) === "salary"
  );

  const riderPaymentEntry = managementEntries.find(
    (e) =>
      e.entityType === "rider" &&
      String(e.entityId) === String(riderId) &&
      dateKey(e.date || e.createdAt) === riderPageDate &&
      normalized(e.type) === "payment"
  );

  const riderNoteEntry = managementEntries.find(
    (e) =>
      e.entityType === "rider" &&
      String(e.entityId) === String(riderId) &&
      dateKey(e.date || e.createdAt) === riderPageDate &&
      normalized(e.type) === "rider_note"
  );

  const riderCheckedEntry = managementEntries.find(
    (e) =>
      e.entityType === "rider" &&
      String(e.entityId) === String(riderId) &&
      dateKey(e.date || e.createdAt) === riderPageDate &&
      normalized(e.type) === "rider_checked"
  );
  const isRiderChecked = Number(riderCheckedEntry?.amount || 0) === 1;

  const [riderInputs, setRiderInputs] = useState({
    collection: "",
    bkash: "",
    nagad: "",
    fine: "",
    salary: "",
    payment: "",
    note: "",
  });

  useEffect(() => {
    setRiderInputs({
      collection: riderCollectionEntry ? String(riderCollectionEntry.amount ?? "") : "",
      bkash: riderBkashEntry ? String(riderBkashEntry.amount ?? "") : "",
      nagad: riderNagadEntry ? String(riderNagadEntry.amount ?? "") : "",
      fine: riderFineEntry ? String(riderFineEntry.amount ?? "") : "",
      salary: riderSalaryEntry ? String(riderSalaryEntry.amount ?? "") : "",
      payment: riderPaymentEntry ? String(riderPaymentEntry.amount ?? "") : "",
      note: riderNoteEntry ? String(riderNoteEntry.note ?? "") : "",
    });
  }, [
    riderId,
    riderPageDate,
    riderCollectionEntry,
    riderBkashEntry,
    riderNagadEntry,
    riderFineEntry,
    riderSalaryEntry,
    riderPaymentEntry,
    riderNoteEntry,
  ]);

  const checkInRestaurantsList = useMemo(() => {
    const ordersOnCheckDate = orders.filter(
      (o) => dateKey(o.createdAt) === checkInDate && !isCancelled(o)
    );

    return restaurants
      .map((r) => {
        const resName = r.name || r.restaurantName || r.id;
        let salesAmount = 0;
        let orderCount = 0;

        ordersOnCheckDate.forEach((o) => {
          const sub = itemSubtotal(o.items, resName, r.id);
          if (sub > 0) {
            salesAmount += sub;
            orderCount += 1;
          }
        });

        const checkedDoc = managementEntries.find(
          (e) =>
            e.entityType === "restaurant" &&
            String(e.entityId) === String(r.id) &&
            dateKey(e.date || e.createdAt) === checkInDate &&
            normalized(e.type) === "restaurant_checked"
        );

        const physicalDoc = managementEntries.find(
          (e) =>
            e.entityType === "restaurant" &&
            String(e.entityId) === String(r.id) &&
            dateKey(e.date || e.createdAt) === checkInDate &&
            ["collection", "physical"].includes(normalized(e.type))
        );

        return {
          ...r,
          displayName: resName,
          salesAmount,
          orderCount,
          isChecked: Number(checkedDoc?.amount || 0) === 1,
          physicalAmount: Number(physicalDoc?.amount || 0),
        };
      })
      .filter((r) =>
        !checkInResSearch
          ? true
          : normalized(r.displayName).includes(normalized(checkInResSearch))
      )
      .sort((a, b) => b.salesAmount - a.salesAmount || a.displayName.localeCompare(b.displayName));
  }, [restaurants, orders, managementEntries, checkInDate, checkInResSearch]);

  const checkInRidersList = useMemo(() => {
    const ordersOnCheckDate = orders.filter(
      (o) => dateKey(o.createdAt) === checkInDate && isDelivered(o)
    );

    return riders
      .map((r) => {
        const riderName = r.name || r.id;
        const riderOrders = ordersOnCheckDate.filter(
          (o) => String(o.riderId || "") === String(r.id)
        );
        const deliveredCount = riderOrders.length;
        const deliveredAmount = riderOrders.reduce((s, o) => s + orderAmount(o), 0);

        const checkedDoc = managementEntries.find(
          (e) =>
            e.entityType === "rider" &&
            String(e.entityId) === String(r.id) &&
            dateKey(e.date || e.createdAt) === checkInDate &&
            normalized(e.type) === "rider_checked"
        );

        return {
          ...r,
          displayName: riderName,
          deliveredCount,
          deliveredAmount,
          isChecked: Number(checkedDoc?.amount || 0) === 1,
        };
      })
      .filter((r) =>
        !checkInRiderSearch
          ? true
          : normalized(r.displayName).includes(normalized(checkInRiderSearch)) ||
            normalized(r.phone || "").includes(normalized(checkInRiderSearch))
      )
      .sort((a, b) => b.deliveredAmount - a.deliveredAmount || a.displayName.localeCompare(b.displayName));
  }, [riders, orders, managementEntries, checkInDate, checkInRiderSearch]);

  const historyRestaurantRows = useMemo(() => {
    if (!historyStart || !historyEnd || !restaurantId) return [];
    const rowsMap = new Map();
    let curr = new Date(historyStart);
    const end = new Date(historyEnd);
    while (curr <= end) {
      const k = dateKey(curr);
      rowsMap.set(k, { date: k, itemSales: 0, physicalAmount: 0 });
      curr.setDate(curr.getDate() + 1);
    }

    orders.forEach((order) => {
      const k = dateKey(order.createdAt);
      if (rowsMap.has(k) && isDelivered(order)) {
        const sub = itemSubtotal(order.items, selectedRestaurant?.name || "", selectedRestaurant?.id || "");
        if (sub > 0) {
          rowsMap.get(k).itemSales += sub;
        }
      }
    });

    managementEntries.forEach((entry) => {
      const k = dateKey(entry.date || entry.createdAt);
      if (
        rowsMap.has(k) &&
        entry.entityType === "restaurant" &&
        String(entry.entityId) === String(restaurantId) &&
        ["collection", "physical"].includes(normalized(entry.type))
      ) {
        rowsMap.get(k).physicalAmount += Number(entry.amount || 0);
      }
    });

    return Array.from(rowsMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [orders, managementEntries, historyStart, historyEnd, restaurantId, selectedRestaurant]);

  const historyRestaurantTotals = useMemo(() => {
    return historyRestaurantRows.reduce(
      (acc, row) => ({
        itemSales: acc.itemSales + row.itemSales,
        physicalAmount: acc.physicalAmount + row.physicalAmount,
      }),
      { itemSales: 0, physicalAmount: 0 }
    );
  }, [historyRestaurantRows]);

  const historyRiderRows = useMemo(() => {
    if (!historyStart || !historyEnd || !riderId) return [];
    const rowsMap = new Map();
    let curr = new Date(historyStart);
    const end = new Date(historyEnd);
    while (curr <= end) {
      const k = dateKey(curr);
      rowsMap.set(k, { date: k, deliveredCount: 0, deliveredCod: 0, collection: 0, fine: 0, salary: 0 });
      curr.setDate(curr.getDate() + 1);
    }

    orders.forEach((order) => {
      const k = dateKey(order.createdAt);
      if (rowsMap.has(k) && String(order.riderId || "") === String(riderId) && isDelivered(order)) {
        rowsMap.get(k).deliveredCount += 1;
        if (isCOD(order)) {
          rowsMap.get(k).deliveredCod += orderAmount(order);
        }
      }
    });

    managementEntries.forEach((entry) => {
      const k = dateKey(entry.date || entry.createdAt);
      if (
        rowsMap.has(k) &&
        entry.entityType === "rider" &&
        String(entry.entityId) === String(riderId)
      ) {
        const type = normalized(entry.type);
        const amt = Number(entry.amount || 0);
        if (type === "collection" || type === "physical") rowsMap.get(k).collection += amt;
        if (type === "fine") rowsMap.get(k).fine += amt;
        if (type === "salary") rowsMap.get(k).salary += amt;
      }
    });

    return Array.from(rowsMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [orders, managementEntries, historyStart, historyEnd, riderId]);

  const historyRiderTotals = useMemo(() => {
    return historyRiderRows.reduce(
      (acc, row) => ({
        deliveredCount: acc.deliveredCount + row.deliveredCount,
        deliveredCod: acc.deliveredCod + row.deliveredCod,
        collection: acc.collection + row.collection,
        fine: acc.fine + row.fine,
        salary: acc.salary + row.salary,
      }),
      { deliveredCount: 0, deliveredCod: 0, collection: 0, fine: 0, salary: 0 }
    );
  }, [historyRiderRows]);

  const saveEntityReportArchive = (type) => {
    const isRes = type === "restaurant";
    const reportObj = {
      id: `${type}-rep-${isRes ? restaurantId : riderId}-${historyStart}-${historyEnd}-${Date.now()}`,
      entityId: isRes ? restaurantId : riderId,
      entityName: isRes ? selectedRestaurant?.name || "Restaurant" : selectedRider?.name || "Rider",
      startDate: historyStart,
      endDate: historyEnd,
      savedAt: new Date().toISOString(),
      rows: isRes ? historyRestaurantRows : historyRiderRows,
      totals: isRes ? historyRestaurantTotals : historyRiderTotals,
      type,
    };
    setSavedEntityReports((prev) => [
      reportObj,
      ...prev.filter(
        (r) =>
          !(
            r.type === type &&
            r.entityId === (isRes ? restaurantId : riderId) &&
            r.startDate === historyStart &&
            r.endDate === historyEnd
          )
      ),
    ]);
    setNotice({ type: "success", text: `${isRes ? "Restaurant" : "Rider"} report permanently saved!` });
  };

  const deleteSavedEntityReport = (id) => {
    setDeleteModalData({
      title: "Delete Saved Report",
      message: "Are you sure you want to delete this saved report? This action cannot be undone.",
      onConfirm: () => {
        setSavedEntityReports((prev) => prev.filter((r) => r.id !== id));
        setNotice({ type: "success", text: "Report deleted successfully." });
      },
    });
  };

  const historyRows = useMemo(() => {
    const rows = new Map();
    const ensure = (key) => {
      if (!rows.has(key)) {
        rows.set(key, {
          date: key,
          sales: 0,
          collection: 0,
          cod: 0,
          fine: 0,
          salary: 0,
          bkash: 0,
          nagad: 0,
          rocket: 0,
        });
      }
      return rows.get(key);
    };

    orders.forEach((order) => {
      const key = dateKey(order.createdAt);
      if (!key || key < historyStart || key > historyEnd) return;
      if (historyType === "restaurant" && isDelivered(order)) {
        ensure(key).sales += itemSubtotal(
          order.items,
          selectedRestaurant?.name || "",
          selectedRestaurant?.id || ""
        );
      }
    });

    if (historyType === "rider") {
      orders.forEach((order) => {
        const key = dateKey(order.createdAt);
        if (!key || key < historyStart || key > historyEnd) return;
        if (String(order.riderId || "") !== String(riderId) || !isDelivered(order) || !isCOD(order)) return;
        ensure(key).cod += orderAmount(order);
      });
    }

    managementEntries.forEach((entry) => {
      const key = dateKey(entry.date || entry.createdAt);
      if (!key || key < historyStart || key > historyEnd) return;
      if (historyType === "restaurant" && entry.entityType !== "restaurant") return;
      if (historyType === "rider" && entry.entityType !== "rider") return;
      if (historyType === "restaurant" && restaurantId && String(entry.entityId) !== String(restaurantId)) return;
      if (historyType === "rider" && riderId && String(entry.entityId) !== String(riderId)) return;
      const type = normalized(entry.type);
      if (type === "collection" || type === "physical") ensure(key).collection += Number(entry.amount || 0);
      if (type === "fine") ensure(key).fine += Number(entry.amount || 0);
      if (type === "salary") ensure(key).salary += Number(entry.amount || 0);
    });

    onlineEntries.forEach((entry) => {
      const key = dateKey(entry.date || entry.createdAt);
      if (!key || key < historyStart || key > historyEnd || historyType !== "online") return;
      const method = normalized(entry.method);
      if (method === "bkash") ensure(key).bkash += Number(entry.amount || 0);
      if (method === "nagad") ensure(key).nagad += Number(entry.amount || 0);
      if (method === "rocket") ensure(key).rocket += Number(entry.amount || 0);
    });

    return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [
    orders,
    managementEntries,
    onlineEntries,
    historyStart,
    historyEnd,
    historyType,
    selectedRestaurant,
    restaurantId,
    riderId,
  ]);

  const historyTotals = historyRows.reduce(
    (total, row) => ({
      sales: total.sales + row.sales,
      collection: total.collection + row.collection,
      cod: total.cod + row.cod,
      fine: total.fine + row.fine,
      salary: total.salary + row.salary,
      bkash: total.bkash + row.bkash,
      nagad: total.nagad + row.nagad,
      rocket: total.rocket + row.rocket,
    }),
    { sales: 0, collection: 0, cod: 0, fine: 0, salary: 0, bkash: 0, nagad: 0, rocket: 0 }
  );

  const navItems = [
    ["overview", "Overview", "◫"],
    ["checkin", "Check In", "✓"],
    ["restaurants", "Restaurants", "▤"],
    ["online-payment", "Online Payment", "💳"],
    ["riders", "Riders", "♧"],
    ["history", "History & Reports", "▦"],
    ["bulk", "Bulk Management", "⚙"],
    ["paperwork", "Paper Work", "📄"],
  ];

  // App Open Running Animation Splash Screen (while Auth & Firestore Sync run in background)
  if (showLaunchSplash || !authReady) {
    return (
      <>
        <style>{styles}</style>
        <div className="boot-screen running-splash">
          <div className="splash-glow-circle" />
          <div className="splash-logo-wrap">
            <FoodishLogo size={68} />
          </div>
          <div className="splash-brand-title">
            Foodish <span>Accounts</span>
          </div>
          <div className="splash-runner-track">
            <div className="splash-runner-scooter">🛵💨</div>
            <div className="splash-runner-bar" />
          </div>
          <p className="splash-sync-text">
            <span className="sync-pulse-dot" /> Syncing live data in background…
          </p>
        </div>
      </>
    );
  }

  if (!user) {
    return (
      <>
        <style>{styles}</style>
        <div className="login-page">
          <div className="login-glow login-glow-one" />
          <div className="login-glow login-glow-two" />
          <main className="login-card">
            <div className="login-brand-mark"><FoodishLogo size={36} /></div>
            <div className="login-brand-name">Foodish <span>Admin</span></div>
            <div className="login-kicker">ACCOUNTS & OPERATIONS CONSOLE</div>
            <div className="login-divider" />
            <h1>Welcome back</h1>
            <p className="login-description">Apnar Foodish Admin account diye login korun.</p>
            {authError && (
              <div className="login-error" role="alert">
                <strong>Login failed</strong>
                <span>{authError}</span>
              </div>
            )}
            <button className="google-login-button" onClick={handleGoogleLogin}>
              <span className="google-g" aria-hidden="true">G</span>
              <span>Continue with Google</span>
              <span className="google-arrow" aria-hidden="true">→</span>
            </button>
            <div className="login-security">
              <span className="security-dot" /> Secure access for authorized administrators only
            </div>
          </main>
          <footer className="login-footer">© {new Date().getFullYear()} Foodish · Internal use only</footer>
        </div>
      </>
    );
  }

  const historySavedEntries =
    historyType === "rider"
      ? [
          ...managementEntries.filter((entry) => {
            const d = dateKey(entry.date || entry.createdAt);
            return (
              d >= historyStart &&
              d <= historyEnd &&
              entry.entityType === "rider" &&
              String(entry.entityId) === String(riderId)
            );
          }),
          ...orders
            .filter((order) => {
              const d = dateKey(order.createdAt);
              return (
                d >= historyStart &&
                d <= historyEnd &&
                String(order.riderId || "") === String(riderId) &&
                isDelivered(order) &&
                isCOD(order)
              );
            })
            .map((order) => ({
              id: `cod-${order.id}`,
              createdAt: order.createdAt,
              date: dateKey(order.createdAt),
              entityName: "COD Amount",
              type: "COD",
              note: `Order #${order.orderId || order.id}`,
              amount: orderAmount(order),
              readOnly: true,
            })),
        ]
      : (historyType === "online" ? onlineEntries : managementEntries).filter((entry) => {
          const d = dateKey(entry.date || entry.createdAt);
          return (
            d >= historyStart &&
            d <= historyEnd &&
            (historyType === "online"
              ? true
              : entry.entityType === historyType && String(entry.entityId) === String(restaurantId))
          );
        });

  return (
    <div className="app-shell">
      <style>{styles}</style>
      {sidebarOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><FoodishLogo size={24} /></div>
          <div><strong>Foodish</strong><small>ACCOUNTS CONSOLE</small></div>
        </div>
        <div className="side-label">WORKSPACE</div>
        <nav>
          {navItems.map(([id, label, icon]) => (
            <button
              key={id}
              className={`nav-link ${page === id ? "active" : ""}`}
              onClick={() => {
                setPage(id);
                setSidebarOpen(false);
              }}
            >
              <span className="nav-icon">{icon}</span>
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="online-dot" /> Firebase connected
          <small>{user?.email}</small>
          <button className="nav-link" onClick={handleSignOut}>Sign out</button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div>
            <button className="mobile-menu-btn" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}>☰</button>
            <div className="eyebrow">FOODISH / FINANCE</div>
            <h1>{navItems.find(([id]) => id === page)?.[1]}</h1>
          </div>
          <div className="topbar-right">
            <button className="primary-btn refresh-btn" onClick={handleManualRefresh} title="Refresh Data">
              🔄 Refresh
            </button>
            <div className="today-chip"><span>●</span> Live data</div>
            <div className="avatar">{(user?.displayName || user?.email || "A").slice(0, 1).toUpperCase()}</div>
          </div>
        </header>

        {dataError && <div className="alert error-alert">{dataError}</div>}
        {loading && <div className="loading-line"><span /> Syncing Firestore data…</div>}

        {/* 1. OVERVIEW PAGE */}
        {page === "overview" && (
          <section key="page-overview" className="content page-animate">
            <div className="section-heading">
              <div>
                <h2>Daily performance & Orders</h2>
                <p>Filter by date, search orders, and view comprehensive order details with restaurant and item info.</p>
              </div>
              <span className="date-label">{new Date().toLocaleDateString("en-BD", { dateStyle: "full" })}</span>
            </div>

            <div className="panel" style={{ padding: "16px", marginBottom: "20px" }}>
              <div className="filter-bar" style={{ margin: 0, border: 0, padding: 0 }}>
                <label>
                  Filter Date
                  <input type="date" value={overviewDate} onChange={(e) => setOverviewDate(e.target.value)} />
                </label>
                <label>
                  Order Status Filter
                  <select value={overviewStatus} onChange={(e) => setOverviewStatus(e.target.value)}>
                    <option value="all">All Orders</option>
                    <option value="delivered">Delivered Only</option>
                    <option value="pending">Pending / Processing</option>
                    <option value="on_the_way">On The Way</option>
                    <option value="cancelled">Cancelled Only</option>
                  </select>
                </label>
                <label style={{ flex: 2 }}>
                  Search Orders (Phone, Order ID, Customer Name, Restaurant)
                  <input
                    type="text"
                    value={overviewSearch}
                    onChange={(e) => setOverviewSearch(e.target.value)}
                    placeholder="Type to search..."
                  />
                </label>
              </div>
            </div>

            <div className="stats-grid orders-card-grid">
              <StatCard label="Delivered total" value={money(deliveredTotalOverview)} hint={`${deliveredOverview.length} delivered orders`} icon="↗" tone="green" />
              <StatCard label="Cancelled total" value={money(cancelledTotalOverview)} hint={`${cancelledOverview.length} cancelled orders`} icon="×" tone="red" />
              <StatCard label="Delivered COD" value={money(codTotalOverview)} hint="Cash on delivery" icon="৳" tone="blue" />
              <StatCard label="Orders on date" value={overviewOrdersOnDate.length.toLocaleString()} hint={`Total orders · ${overviewDate}`} icon="▤" tone="purple" />
            </div>

            <div className="panel">
              <div className="panel-head">
                <div>
                  <h3>Filtered Orders ({overviewFilteredOrders.length})</h3>
                  <p>Showing orders for date: {overviewDate}</p>
                </div>
              </div>

              <div className="table-wrap universal-card-list">
                <table>
                  <thead>
                    <tr>
                      <th>Order ID</th>
                      <th>Customer Info</th>
                      <th>Items & Restaurants Details</th>
                      <th>Rider Info</th>
                      <th>Time</th>
                      <th>Payment</th>
                      <th>Status</th>
                      <th className="right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overviewFilteredOrders.map((order, idx) => {
                      const matchedRider = riders.find((r) => String(r.id) === String(order.riderId));
                      const riderDisplayName = matchedRider ? matchedRider.name || matchedRider.id : order.riderName || "—";
                      const riderPhoneNum = matchedRider ? matchedRider.phone || "" : order.riderPhone || "";
                      const orderNote = order.note || order.orderNote || order.instructions || "";

                      const borderColors = ["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ec4899", "#06b6d4"];
                      const cardBorderColor = borderColors[idx % borderColors.length];

                      return (
                        <tr key={order.id} style={{ "--card-border-color": cardBorderColor }}>
                          <td data-label="Order ID">
                            <strong>#{order.orderId || order.id.slice(0, 8)}</strong>
                          </td>
                          <td data-label="Customer Info">
                            <div className="card-value-block">
                              <strong>{order.userName || "—"}</strong>
                              <small className="cell-sub">{order.userPhone || ""}</small>
                            </div>
                          </td>
                          <td data-label="Items & Restaurants Details">
                            <div className="card-value-block">
                              <OrderItemsBreakdown items={order.items} />
                              {orderNote && (
                                <div
                                  style={{
                                    marginTop: "10px",
                                    padding: "10px 14px",
                                    background: "#fef2f2",
                                    border: "2px solid #ef4444",
                                    borderRadius: "10px",
                                    color: "#b91c1c",
                                    fontWeight: "900",
                                    fontSize: "15px",
                                    lineHeight: "1.5",
                                    boxShadow: "0 2px 6px rgba(239,68,68,0.15)",
                                  }}
                                >
                                  🚨 <span style={{ textDecoration: "underline" }}>ORDER NOTE</span>: {orderNote}
                                </div>
                              )}
                            </div>
                          </td>
                          <td data-label="Rider Info">
                            <div className="card-value-block">
                              <strong>{riderDisplayName}</strong>
                              {riderPhoneNum && <small className="cell-sub">Phone: {riderPhoneNum}</small>}
                            </div>
                          </td>
                          <td data-label="Time">{formatDateTime(order.createdAt)}</td>
                          <td data-label="Payment">
                            <span style={{ fontWeight: "700" }}>{order.payment || order.paymentMethod || "—"}</span>
                          </td>
                          <td data-label="Status">
                            <span className={`status ${isDelivered(order) ? "good" : isCancelled(order) ? "bad" : "pending"}`}>
                              {order.orderStatus || "Pending"}
                            </span>
                          </td>
                          <td data-label="Total" className="right">
                            <strong style={{ fontSize: "16px", color: "#0f172a" }}>{money(orderAmount(order))}</strong>
                          </td>
                        </tr>
                      );
                    })}
                    {overviewFilteredOrders.length === 0 && (
                      <tr>
                        <td colSpan={8} className="empty-cell">No orders found matching your search and filter.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* CHECK-IN PAGE */}
        {page === "checkin" && (
          <section key="page-checkin" className="content checkin-mobile-page page-animate">
            <div className="section-heading">
              <div>
                <h2>Daily Check-In Status</h2>
                <p>Restaurants are sorted from highest to lowest sales. Verify check-in status on {checkInDate}.</p>
              </div>
            </div>

            <div className="filter-bar checkin-filter-bar">
              <label>
                Check-In Date
                <input
                  type="date"
                  value={checkInDate}
                  onChange={(e) => setCheckInDate(e.target.value)}
                />
              </label>
              <label>
                Search Restaurant
                <input
                  type="text"
                  value={checkInResSearch}
                  onChange={(e) => setCheckInResSearch(e.target.value)}
                  placeholder="Filter restaurants..."
                />
              </label>
              <label>
                Search Rider
                <input
                  type="text"
                  value={checkInRiderSearch}
                  onChange={(e) => setCheckInRiderSearch(e.target.value)}
                  placeholder="Filter riders..."
                />
              </label>
            </div>

            <div className="stats-grid checkin-stats-grid" style={{ marginBottom: "20px" }}>
              <StatCard
                label="Restaurants Checked"
                value={`${checkInRestaurantsList.filter((r) => r.isChecked).length} / ${checkInRestaurantsList.length}`}
                hint={`Checked on ${checkInDate}`}
                icon="✓"
                tone="green"
              />
              <StatCard
                label="Restaurants Pending"
                value={checkInRestaurantsList.filter((r) => !r.isChecked).length}
                hint="Not checked yet"
                icon="!"
                tone="red"
              />
              <StatCard
                label="Riders Checked"
                value={`${checkInRidersList.filter((r) => r.isChecked).length} / ${checkInRidersList.length}`}
                hint={`Checked on ${checkInDate}`}
                icon="✓"
                tone="blue"
              />
              <StatCard
                label="Riders Pending"
                value={checkInRidersList.filter((r) => !r.isChecked).length}
                hint="Not checked yet"
                icon="!"
                tone="orange"
              />
            </div>

            <div className="checkin-columns-grid">
              <div className="panel checkin-panel" style={{ margin: 0 }}>
                <div className="panel-head">
                  <div>
                    <h3>🍽️ Restaurants (Highest Sales)</h3>
                    <p>Sorted by total sales on {checkInDate}</p>
                  </div>
                  <span className="count-pill">{checkInRestaurantsList.length}</span>
                </div>

                <div className="checkin-card-list">
                  {checkInRestaurantsList.map((res, index) => (
                    <div
                      key={res.id}
                      className={`checkin-item-card ${res.isChecked ? "is-checked" : ""}`}
                    >
                      <div className="checkin-card-top">
                        <div className="checkin-title-wrap">
                          <span className="checkin-rank">#{index + 1}</span>
                          <div className="checkin-name-group">
                            <strong className="checkin-entity-name">{res.displayName}</strong>
                            <small className="checkin-sub-info">
                              {res.orderCount} orders · Physical: {money(res.physicalAmount)}
                            </small>
                          </div>
                        </div>

                        <button
                          type="button"
                          className={`checkin-toggle-btn ${res.isChecked ? "checked" : "unchecked"}`}
                          onClick={() =>
                            handleUpdateManagementEntry({
                              entityType: "restaurant",
                              entityId: res.id,
                              entityName: res.displayName,
                              type: "restaurant_checked",
                              amount: res.isChecked ? 0 : 1,
                              date: checkInDate,
                            })
                          }
                        >
                          {res.isChecked ? "✓ Checked" : "✕ Unchecked"}
                        </button>
                      </div>

                      <div className="checkin-card-bottom">
                        <span className="checkin-metric-label">Sales ({checkInDate})</span>
                        <strong
                          className="checkin-metric-value"
                          style={{ color: res.salesAmount > 0 ? "#047857" : "#64748b" }}
                        >
                          {money(res.salesAmount)}
                        </strong>
                      </div>
                    </div>
                  ))}
                  {checkInRestaurantsList.length === 0 && (
                    <div className="empty-cell">No restaurants found.</div>
                  )}
                </div>
              </div>

              <div className="panel checkin-panel" style={{ margin: 0 }}>
                <div className="panel-head">
                  <div>
                    <h3>🛵 Riders Check-In List</h3>
                    <p>Check status on {checkInDate}</p>
                  </div>
                  <span className="count-pill">{checkInRidersList.length}</span>
                </div>

                <div className="checkin-card-list">
                  {checkInRidersList.map((rid, index) => (
                    <div
                      key={rid.id}
                      className={`checkin-item-card ${rid.isChecked ? "is-checked" : ""}`}
                    >
                      <div className="checkin-card-top">
                        <div className="checkin-title-wrap">
                          <span className="checkin-rank">#{index + 1}</span>
                          <div className="checkin-name-group">
                            <strong className="checkin-entity-name">{rid.displayName}</strong>
                            <small className="checkin-sub-info">{rid.phone || "No Phone"}</small>
                          </div>
                        </div>

                        <button
                          type="button"
                          className={`checkin-toggle-btn ${rid.isChecked ? "checked" : "unchecked"}`}
                          onClick={() =>
                            handleUpdateManagementEntry({
                              entityType: "rider",
                              entityId: rid.id,
                              entityName: rid.displayName,
                              type: "rider_checked",
                              amount: rid.isChecked ? 0 : 1,
                              date: checkInDate,
                            })
                          }
                        >
                          {rid.isChecked ? "✓ Checked" : "✕ Unchecked"}
                        </button>
                      </div>

                      <div className="checkin-card-bottom">
                        <span className="checkin-metric-label">
                          Delivered ({rid.deliveredCount} orders)
                        </span>
                        <strong className="checkin-metric-value">
                          {money(rid.deliveredAmount)}
                        </strong>
                      </div>
                    </div>
                  ))}
                  {checkInRidersList.length === 0 && (
                    <div className="empty-cell">No riders found.</div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* 2. ONLINE PAYMENT REPORT PAGE (bKash, Nagad, Rocket) */}
        {page === "online-payment" && (
          <section key="page-online-payment" className="content page-animate">
            <div className="section-heading print-hide">
              <div>
                <h2>Online Payment Orders Report</h2>
                <p>View bKash, Nagad, and Rocket payment records with customer details, payment amounts, and PDF download option.</p>
              </div>
              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <button className="primary-btn" onClick={() => handlePrintReport(`Online_Payments_${onlinePayDate}`)} style={{ background: "#3b82f6" }}>🖨️ Print / Download PDF</button>
              </div>
            </div>

            <div className="panel print-hide">
              <div className="filter-bar">
                <label>
                  Filter Date
                  <input type="date" value={onlinePayDate} onChange={(e) => setOnlinePayDate(e.target.value)} />
                </label>
                <label>
                  Payment Method
                  <select value={onlinePayMethodFilter} onChange={(e) => setOnlinePayMethodFilter(e.target.value)}>
                    <option value="all">All Online Methods</option>
                    <option value="bkash">bKash Only</option>
                    <option value="nagad">Nagad Only</option>
                    <option value="rocket">Rocket Only</option>
                  </select>
                </label>
                <label style={{ flex: 2 }}>
                  Search (Order ID, Customer Phone, Name)
                  <input
                    type="text"
                    value={onlinePaySearch}
                    onChange={(e) => setOnlinePaySearch(e.target.value)}
                    placeholder="Search online orders..."
                  />
                </label>
              </div>
            </div>

            <div className="stats-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", marginBottom: "20px" }}>
              <StatCard label="Total bKash Collection" value={money(onlinePaymentTotals.bkash)} hint={`bKash payments · ${onlinePayDate}`} icon="B" tone="pink" />
              <StatCard label="Total Nagad Collection" value={money(onlinePaymentTotals.nagad)} hint={`Nagad payments · ${onlinePayDate}`} icon="N" tone="orange" />
              <StatCard label="Total Rocket Collection" value={money(onlinePaymentTotals.rocket)} hint={`Rocket payments · ${onlinePayDate}`} icon="R" tone="purple" />
              <StatCard label="Grand Online Total" value={money(onlinePaymentTotals.total)} hint={`Combined online · ${onlinePayDate}`} icon="৳" tone="green" />
            </div>

            <div className="printable-report-area history-print-box" style={{ background: "#fff", padding: "30px", borderRadius: "14px", border: "1px solid #e2e8f0", position: "relative" }}>
              <div className="pdf-watermark-logo" style={{ display: "none", position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", opacity: 0.05, pointerEvents: "none", zIndex: 0 }}>
                <FoodishLogo size={360} />
              </div>

              <div className="print-header" style={{ textAlign: "center", marginBottom: "30px", position: "relative", zIndex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", marginBottom: "4px" }}>
                  <FoodishLogo size={36} />
                  <span style={{ fontSize: "28px", fontWeight: "900", letterSpacing: "2px", color: "#10b981" }}>FOODISH</span>
                </div>
                <h1 style={{ fontSize: "28px", fontWeight: "900", color: "#0f172a", margin: "0 0 8px", textTransform: "uppercase" }}>
                  Online Payment Transactions Report
                </h1>
                <p style={{ fontSize: "15px", fontWeight: "700", color: "#475569", margin: 0 }}>
                  Date: {onlinePayDate}
                </p>
              </div>

              <div className="panel" style={{ border: 0, padding: 0, boxShadow: "none", position: "relative", zIndex: 1 }}>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Order ID</th>
                        <th>Customer Name & Phone</th>
                        <th style={{ minWidth: "130px" }}>Payment Method & Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {onlinePaymentOrders.map((order) => {
                        const paymentMethodName = order.payment || order.paymentMethod || "Online";
                        const norm = normalized(paymentMethodName);
                        const isBk = norm.includes("bkash");
                        const isNag = norm.includes("nagad");
                        const isRoc = norm.includes("rocket");

                        return (
                          <tr key={order.id}>
                            <td>{formatDateTime(order.createdAt)}</td>
                            <td><strong>#{order.orderId || order.id.slice(0, 8)}</strong></td>
                            <td>
                              <div><strong>{order.userName || "—"}</strong></div>
                              <small className="cell-sub" style={{ color: "#2563eb", fontWeight: "700" }}>{order.userPhone || "No Phone"}</small>
                            </td>
                            <td style={{ minWidth: "130px" }}>
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "7px" }}>
                                <span
                                  className="status"
                                  style={{
                                    textTransform: "uppercase",
                                    background: isBk ? "#fce7f3" : isNag ? "#ffedd5" : isRoc ? "#ede9fe" : "#f1f5f9",
                                    color: isBk ? "#db2777" : isNag ? "#ea580c" : isRoc ? "#7c3aed" : "#475569",
                                  }}
                                >
                                  {paymentMethodName}
                                </span>
                                <strong style={{ color: "#047857", fontSize: "14px" }}>
                                  {money(orderAmount(order))}
                                </strong>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {onlinePaymentOrders.length === 0 && (
                        <tr>
                          <td colSpan={4} className="empty-cell">No online payment orders found for {onlinePayDate}.</td>
                        </tr>
                      )}
                    </tbody>
                    {onlinePaymentOrders.length > 0 && (
                      <tfoot>
                        <tr>
                          <th colSpan={3}>Total Online Collection</th>
                          <th className="right">{money(onlinePaymentTotals.total)}</th>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>

              <div style={{ marginTop: "30px", display: "flex", justifyContent: "flex-end", position: "relative", zIndex: 1 }} className="print-hide">
                <button className="primary-btn" onClick={() => handlePrintReport(`Online_Payments_${onlinePayDate}`)} style={{ background: "#3b82f6" }}>🖨️ Print / Download PDF</button>
              </div>
            </div>
          </section>
        )}

        {/* 3. RESTAURANTS PAGE */}
        {page === "restaurants" && (
          <section key="page-restaurants" className="content page-animate">
            <div className="section-heading print-hide" style={{ marginBottom: "14px" }}>
              <div>
                <h2>Restaurant accounts & Orders</h2>
                <p>View daily restaurant orders, physical collections, or date-range summary with plus/minus, fine & PDF statement.</p>
              </div>
            </div>

            <div
              className="tabs print-hide"
              style={{
                background: "#ffffff",
                padding: "6px 10px 0",
                borderRadius: "12px",
                border: "1px solid #e2e8f0",
                marginBottom: "18px",
                gap: "8px",
              }}
            >
              <button
                type="button"
                className={restaurantTab === "daily" ? "selected" : ""}
                onClick={() => setRestaurantTab("daily")}
                style={{ fontSize: "13px", padding: "10px 18px" }}
              >
                📋 Daily Accounts & Orders
              </button>
              <button
                type="button"
                className={restaurantTab === "summary" ? "selected" : ""}
                onClick={() => setRestaurantTab("summary")}
                style={{ fontSize: "13px", padding: "10px 18px" }}
              >
                📊 Summary (Date Range)
              </button>
            </div>

            {/* TAB 1: DAILY RESTAURANT ACCOUNTS & ORDERS */}
            {restaurantTab === "daily" && (
              <div key="res-tab-daily" className="tab-pane-animate">
                <div className="filter-bar">
                  <label>
                    Restaurant
                    <select value={restaurantId} onChange={(e) => setRestaurantId(e.target.value)}>
                      {restaurants.map((r) => (
                        <option key={r.id} value={r.id}>{r.name || r.id}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Filter Date
                    <input type="date" value={resPageDate} onChange={(e) => setResPageDate(e.target.value)} />
                  </label>
                  <label>
                    Order Status Filter
                    <select value={resPageStatus} onChange={(e) => setResPageStatus(e.target.value)}>
                      <option value="all">All Orders</option>
                      <option value="delivered">Delivered Only</option>
                      <option value="pending">Pending / Processing</option>
                      <option value="on_the_way">On The Way</option>
                      <option value="cancelled">Cancelled Only</option>
                    </select>
                  </label>
                  <label style={{ flex: 2 }}>
                    Search Orders (Order ID, Customer Name, Phone)
                    <input
                      type="text"
                      value={resPageSearch}
                      onChange={(e) => setResPageSearch(e.target.value)}
                      placeholder="Search in restaurant orders..."
                    />
                  </label>
                </div>

                <div className="stats-grid orders-card-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginBottom: "20px" }}>
                  <StatCard label="Delivered Subtotal" value={money(restaurantPageStats.deliveredTotal)} hint={`Delivered items subtotal · ${resPageDate}`} icon="✓" tone="green" />
                  <StatCard label="Pending / On The Way" value={money(restaurantPageStats.pendingTotal)} hint={`Not delivered yet · ${resPageDate}`} icon="⌛" tone="orange" />
                  <StatCard label="Cancelled Subtotal" value={money(restaurantPageStats.cancelledTotal)} hint={`Cancelled items subtotal · ${resPageDate}`} icon="×" tone="red" />
                </div>

                <div
                  className="panel"
                  style={{
                    background: isRestaurantChecked ? "#f0fdf4" : "#ffffff",
                    border: isRestaurantChecked ? "2px solid #16a34a" : "1px solid #e2e8f0",
                    padding: "20px",
                    borderRadius: "14px",
                    marginBottom: "20px",
                    boxShadow: "0 2px 7px rgba(20,33,59,0.03)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "15px" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        <span style={{ fontSize: "11px", fontWeight: "700", color: "#64748b", letterSpacing: "0.5px" }}>
                          PHYSICAL CASH COLLECTION ({resPageDate})
                        </span>
                        <button
                          style={{
                            background: "#eff6ff",
                            color: "#3b82f6",
                            border: "1px solid #bfdbfe",
                            borderRadius: "6px",
                            padding: "2px 8px",
                            fontSize: "11px",
                            fontWeight: "700",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                          onClick={() => {
                            setNoteModalEntry({
                              type: "physical",
                              entityType: "restaurant",
                              entityId: restaurantId,
                              entityName: selectedRestaurant?.name || "Restaurant",
                              date: resPageDate,
                              amount: restaurantPhysicalEntry ? restaurantPhysicalEntry.amount : 0,
                              note: restaurantPhysicalEntry ? restaurantPhysicalEntry.note || "" : "",
                            });
                            setNoteInputVal(restaurantPhysicalEntry ? restaurantPhysicalEntry.note || "" : "");
                          }}
                          title="View or Add Note"
                        >
                          📝 Note {restaurantPhysicalEntry?.note ? "•" : ""}
                        </button>
                      </div>
                      <div style={{ fontSize: "30px", fontWeight: "900", color: "#0f172a", marginTop: "6px" }}>
                        {money(restaurantPhysicalEntry ? restaurantPhysicalEntry.amount : 0)}
                      </div>
                      <div style={{ fontSize: "11px", color: "#475569", marginTop: "4px", fontWeight: "700" }}>
                        {isRestaurantChecked
                          ? "✓ Checked & added to Check-In list (Auto or Manual saved)."
                          : "✕ Unchecked: Click ✓ Auto or ✏️ Edit Amount to save & add to Check-In list."}
                      </div>
                      {restaurantPhysicalEntry?.note && (
                        <div style={{ fontSize: "12px", color: "#475569", marginTop: "4px", fontStyle: "italic" }}>
                          "{restaurantPhysicalEntry.note}"
                        </div>
                      )}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                      <div
                        style={{
                          display: "inline-flex",
                          borderRadius: "10px",
                          overflow: "hidden",
                          border: "2px solid #cbd5e1",
                          background: "#f8fafc",
                        }}
                      >
                        <button
                          type="button"
                          disabled={saving || !restaurantId}
                          onClick={() => handleToggleRestaurantCheck(true)}
                          title="Tick: Auto-save Delivered + Pending/On The Way"
                          style={{
                            border: 0,
                            padding: "0 14px",
                            height: "38px",
                            background: isRestaurantChecked ? "#16a34a" : "transparent",
                            color: isRestaurantChecked ? "#ffffff" : "#475569",
                            fontWeight: "900",
                            fontSize: "13px",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "5px",
                          }}
                        >
                          ✓ Auto
                        </button>
                        <button
                          type="button"
                          disabled={saving || !restaurantId}
                          onClick={() => handleToggleRestaurantCheck(false)}
                          title="Cross: Uncheck / Manual entry mode"
                          style={{
                            border: 0,
                            borderLeft: "1px solid #cbd5e1",
                            padding: "0 14px",
                            height: "38px",
                            background: !isRestaurantChecked ? "#dc2626" : "transparent",
                            color: !isRestaurantChecked ? "#ffffff" : "#475569",
                            fontWeight: "900",
                            fontSize: "13px",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "5px",
                          }}
                        >
                          ✕ Manual
                        </button>
                      </div>

                      <button
                        className="primary-btn"
                        style={{
                          background: "#10b981",
                          height: "40px",
                          padding: "0 16px",
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          fontSize: "13px",
                          fontWeight: "800",
                        }}
                        onClick={() => {
                          setEditModalData({
                            entityType: "restaurant",
                            entityId: restaurantId,
                            entityName: selectedRestaurant?.name || "Restaurant",
                            type: "physical",
                            amount: restaurantPhysicalEntry ? restaurantPhysicalEntry.amount : 0,
                            date: resPageDate,
                            title: "Edit Physical Cash Amount",
                          });
                          setEditAmountVal(restaurantPhysicalEntry ? restaurantPhysicalEntry.amount : "");
                        }}
                        title="Edit Amount Manually"
                      >
                        ✏️ Edit Amount
                      </button>
                    </div>
                  </div>
                </div>

                <div className="panel">
                  <div className="panel-head">
                    <div>
                      <h3>Restaurant Orders ({restaurantPageOrders.length})</h3>
                      <p>Full order breakdown with items & prices. Amount counted specifically for: <strong>{selectedRestaurant?.name || "Selected Restaurant"}</strong></p>
                    </div>
                  </div>

                  <div className="table-wrap universal-card-list">
                    <table>
                      <thead>
                        <tr>
                          <th>Order ID</th>
                          <th>Customer</th>
                          <th>Full Order Items & Multi-Restaurant Details</th>
                          <th>Rider Details</th>
                          <th>Time</th>
                          <th>Status</th>
                          <th className="right">This Restaurant Subtotal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {restaurantPageOrders.map((order, idx) => {
                          const matchedRider = riders.find((r) => String(r.id) === String(order.riderId));
                          const riderName = matchedRider ? matchedRider.name || matchedRider.id : order.riderName || "—";
                          const riderPhone = matchedRider ? matchedRider.phone || "N/A" : order.riderPhone || "N/A";
                          const orderNote = order.note || order.orderNote || order.instructions || "";

                          const borderColors = ["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ec4899", "#06b6d4"];
                          const cardBorderColor = borderColors[idx % borderColors.length];

                          return (
                            <tr key={order.id} style={{ "--card-border-color": cardBorderColor }}>
                              <td data-label="Order ID">
                                <strong>#{order.orderId || order.id.slice(0, 8)}</strong>
                              </td>
                              <td data-label="Customer">
                                <div className="card-value-block">
                                  <strong>{order.userName || "—"}</strong>
                                  <small className="cell-sub">{order.userPhone || ""}</small>
                                </div>
                              </td>
                              <td data-label="Full Order Items & Multi-Restaurant Details">
                                <div className="card-value-block">
                                  <OrderItemsBreakdown
                                    items={order.items}
                                    highlightRestaurantName={selectedRestaurant?.name}
                                    highlightRestaurantId={selectedRestaurant?.id}
                                  />
                                  {orderNote && (
                                    <div
                                      style={{
                                        marginTop: "10px",
                                        padding: "10px 14px",
                                        background: "#fef2f2",
                                        border: "2px solid #ef4444",
                                        borderRadius: "10px",
                                        color: "#b91c1c",
                                        fontWeight: "900",
                                        fontSize: "15px",
                                        lineHeight: "1.5",
                                        boxShadow: "0 2px 6px rgba(239,68,68,0.15)",
                                      }}
                                    >
                                      🚨 <span style={{ textDecoration: "underline" }}>ORDER NOTE</span>: {orderNote}
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td data-label="Rider Details">
                                <div className="card-value-block">
                                  <strong>{riderName}</strong>
                                  <small className="cell-sub">Phone: {riderPhone}</small>
                                </div>
                              </td>
                              <td data-label="Time">{formatDateTime(order.createdAt)}</td>
                              <td data-label="Status">
                                <span className={`status ${isDelivered(order) ? "good" : isCancelled(order) ? "bad" : "pending"}`}>
                                  {order.orderStatus || "Pending"}
                                </span>
                              </td>
                              <td data-label="This Restaurant Subtotal" className="right">
                                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                                  <strong style={{ fontSize: "16px", color: "#047857" }}>{money(order.restaurantSubtotal)}</strong>
                                  <small style={{ fontSize: "11px", color: "#64748b" }}>Order Total: {money(orderAmount(order))}</small>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {restaurantPageOrders.length === 0 && (
                          <tr>
                            <td colSpan={7} className="empty-cell">No orders found matching your search and filters.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: RESTAURANT DATE-RANGE SUMMARY */}
            {restaurantTab === "summary" && (
              <div key="res-tab-summary" className="tab-pane-animate">
                <div className="filter-bar print-hide">
                  <label>
                    Restaurant
                    <select value={restaurantId} onChange={(e) => setRestaurantId(e.target.value)}>
                      {restaurants.map((r) => (
                        <option key={r.id} value={r.id}>{r.name || r.id}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    From Date
                    <input
                      type="date"
                      value={resSummaryStart}
                      onChange={(e) => setResSummaryStart(e.target.value)}
                    />
                  </label>
                  <label>
                    To Date
                    <input
                      type="date"
                      value={resSummaryEnd}
                      min={resSummaryStart}
                      onChange={(e) => setResSummaryEnd(e.target.value)}
                    />
                  </label>
                  <div style={{ display: "flex", gap: "10px", alignItems: "flex-end", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="primary-btn"
                      onClick={() =>
                        handlePrintReport(
                          `${selectedRestaurant?.name || "Restaurant"}_${resSummaryStart}_to_${resSummaryEnd}`
                        )
                      }
                      style={{ height: "38px", padding: "0 16px", background: "#3b82f6" }}
                    >
                      🖨️ Print / Download PDF
                    </button>
                  </div>
                </div>

                {/* 2-OPTION SELECTION BUTTONS: TOTAL SELL vs PHYSICAL AMOUNT */}
                {!activeSavedResStatement && (
                  <div
                    className="panel print-hide"
                    style={{
                      padding: "16px",
                      marginBottom: "18px",
                      background: "#f8fafc",
                      border: "1.5px solid #cbd5e1",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "12px",
                        fontWeight: "800",
                        color: "#334155",
                        marginBottom: "10px",
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                      }}
                    >
                      🎯 হিসাবের ভিত্তি সিলেক্ট করুন (Choose Calculation Base):
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                        gap: "12px",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setResSummaryBaseType("sell")}
                        style={{
                          padding: "14px 16px",
                          borderRadius: "12px",
                          border: resSummaryBaseType === "sell" ? "2.5px solid #059669" : "1.5px solid #cbd5e1",
                          background: resSummaryBaseType === "sell" ? "#ecfdf5" : "#ffffff",
                          color: resSummaryBaseType === "sell" ? "#065f46" : "#475569",
                          fontWeight: "800",
                          fontSize: "14px",
                          cursor: "pointer",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-start",
                          gap: "4px",
                          boxShadow: resSummaryBaseType === "sell" ? "0 4px 12px rgba(16,185,129,0.18)" : "none",
                          transition: "all 0.2s ease",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                          <span>💰 Total Sell (Delivered)</span>
                          <span
                            style={{
                              fontSize: "11px",
                              padding: "2px 8px",
                              borderRadius: "12px",
                              background: resSummaryBaseType === "sell" ? "#10b981" : "#e2e8f0",
                              color: resSummaryBaseType === "sell" ? "#ffffff" : "#475569",
                            }}
                          >
                            {resSummaryBaseType === "sell" ? "✓ Selected" : "Select"}
                          </span>
                        </div>
                        <span style={{ fontSize: "20px", fontWeight: "900", color: resSummaryBaseType === "sell" ? "#047857" : "#0f172a" }}>
                          {money(restaurantRangeSummary.deliveredSubtotal)}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setResSummaryBaseType("physical")}
                        style={{
                          padding: "14px 16px",
                          borderRadius: "12px",
                          border: resSummaryBaseType === "physical" ? "2.5px solid #2563eb" : "1.5px solid #cbd5e1",
                          background: resSummaryBaseType === "physical" ? "#eff6ff" : "#ffffff",
                          color: resSummaryBaseType === "physical" ? "#1e40af" : "#475569",
                          fontWeight: "800",
                          fontSize: "14px",
                          cursor: "pointer",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-start",
                          gap: "4px",
                          boxShadow: resSummaryBaseType === "physical" ? "0 4px 12px rgba(37,99,235,0.18)" : "none",
                          transition: "all 0.2s ease",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                          <span>💵 Physical Cash Amount</span>
                          <span
                            style={{
                              fontSize: "11px",
                              padding: "2px 8px",
                              borderRadius: "12px",
                              background: resSummaryBaseType === "physical" ? "#2563eb" : "#e2e8f0",
                              color: resSummaryBaseType === "physical" ? "#ffffff" : "#475569",
                            }}
                          >
                            {resSummaryBaseType === "physical" ? "✓ Selected" : "Select"}
                          </span>
                        </div>
                        <span style={{ fontSize: "20px", fontWeight: "900", color: resSummaryBaseType === "physical" ? "#1d4ed8" : "#0f172a" }}>
                          {money(restaurantRangeSummary.physicalTotal)}
                        </span>
                      </button>
                    </div>
                  </div>
                )}

                {firestoreRestaurantStatements.length > 0 && (
                  <div className="panel print-hide">
                    <div className="panel-head">
                      <div>
                        <h3>🔒 Saved Restaurant Statements Archive (Permanent & Locked)</h3>
                        <p>Once saved, statements cannot be modified. View, Print PDF, Download CSV, or Delete anytime.</p>
                      </div>
                      <span className="count-pill">{firestoreRestaurantStatements.length} saved</span>
                    </div>

                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Restaurant Name</th>
                            <th>From Date → To Date</th>
                            <th>Calculation Base</th>
                            <th>Net Final Total</th>
                            <th>Saved At</th>
                            <th className="right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...firestoreRestaurantStatements]
                            .sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")))
                            .map((st) => (
                              <tr key={st.id}>
                                <td><strong>{st.restaurantName}</strong></td>
                                <td>{st.fromDate} to {st.toDate}</td>
                                <td>
                                  <div><strong>{money(st.baseTotal)}</strong></div>
                                  <small className="cell-sub">{st.baseLabel || "Total Delivered Amount"}</small>
                                </td>
                                <td>
                                  <strong style={{ color: "#047857", fontSize: "15px" }}>
                                    {money(st.netTotal)}
                                  </strong>
                                </td>
                                <td>{formatDateTime(st.savedAt)}</td>
                                <td className="right" style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                                  <button
                                    type="button"
                                    className="primary-btn"
                                    style={{ height: "32px", padding: "0 12px", fontSize: "11px", background: "#059669" }}
                                    onClick={() => setActiveSavedResStatement(st)}
                                  >
                                    👁️ View / Print
                                  </button>
                                  <button
                                    type="button"
                                    className="primary-btn"
                                    style={{ height: "32px", padding: "0 12px", fontSize: "11px", background: "#2563eb" }}
                                    onClick={() => downloadRestaurantStatementCSV(st)}
                                  >
                                    📥 CSV
                                  </button>
                                  <button
                                    type="button"
                                    className="delete-btn"
                                    style={{ height: "32px", padding: "0 12px", fontSize: "11px" }}
                                    onClick={() => deleteSavedRestaurantStatement(st.id)}
                                  >
                                    🗑️ Delete
                                  </button>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {(() => {
                  const isLockedView = Boolean(activeSavedResStatement);
                  const activeBaseLabel = isLockedView
                    ? activeSavedResStatement.baseLabel ||
                      (activeSavedResStatement.baseType === "physical"
                        ? "Physical Cash Amount"
                        : "Total Sell (Delivered Items)")
                    : resSummaryBaseType === "physical"
                    ? "Physical Cash Amount"
                    : "Total Sell (Delivered Items)";

                  const displayData = isLockedView
                    ? activeSavedResStatement
                    : {
                        restaurantName: selectedRestaurant?.name || "Selected Restaurant",
                        fromDate: resSummaryStart,
                        toDate: resSummaryEnd,
                        deliveredCount: restaurantRangeSummary.deliveredCount,
                        baseLabel: activeBaseLabel,
                        baseTotal: resSummaryCalculation.baseTotal,
                        plusSum: resSummaryCalculation.plusSum,
                        minusSum: resSummaryCalculation.minusSum,
                        fineSum: resSummaryCalculation.fineSum ?? 0,
                        netTotal: resSummaryCalculation.netTotal,
                        adjustments: resAdjustments,
                        orderNotes: restaurantRangeSummary.orderNotesList,
                      };

                  const resolvedFineSum = Number(displayData.fineSum ?? 0);

                  return (
                    <div
                      className="printable-report-area history-print-box"
                      style={{
                        background: "#ffffff",
                        padding: "26px",
                        borderRadius: "16px",
                        border: isLockedView ? "2px solid #059669" : "1px solid #e2e8f0",
                        position: "relative",
                      }}
                    >
                      <div
                        className="pdf-watermark-logo"
                        style={{
                          display: "none",
                          position: "absolute",
                          top: "50%",
                          left: "50%",
                          transform: "translate(-50%, -50%)",
                          opacity: 0.05,
                          pointerEvents: "none",
                          zIndex: 0,
                        }}
                      >
                        <FoodishLogo size={360} />
                      </div>

                      {isLockedView && (
                        <div
                          className="print-hide"
                          style={{
                            background: "#ecfdf5",
                            border: "1px solid #10b981",
                            borderRadius: "10px",
                            padding: "12px 16px",
                            marginBottom: "18px",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: "10px",
                          }}
                        >
                          <div style={{ fontSize: "13px", fontWeight: "800", color: "#065f46" }}>
                            🔒 Viewing Permanently Saved Restaurant Statement (Read-Only / Locked)
                          </div>
                          <div style={{ display: "flex", gap: "8px" }}>
                            <button
                              type="button"
                              className="primary-btn"
                              style={{ height: "34px", padding: "0 14px", fontSize: "12px", background: "#3b82f6" }}
                              onClick={() =>
                                handlePrintReport(
                                  `${displayData.restaurantName}_${displayData.fromDate}_to_${displayData.toDate}`
                                )
                              }
                            >
                              🖨️ Print / PDF
                            </button>
                            <button
                              type="button"
                              className="primary-btn"
                              style={{ height: "34px", padding: "0 14px", fontSize: "12px", background: "#2563eb" }}
                              onClick={() => downloadRestaurantStatementCSV(displayData)}
                            >
                              📥 Download CSV
                            </button>
                            <button
                              type="button"
                              className="primary-btn"
                              style={{ height: "34px", padding: "0 14px", fontSize: "12px", background: "#64748b" }}
                              onClick={() => setActiveSavedResStatement(null)}
                            >
                              ✕ Close Saved View
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="print-header" style={{ textAlign: "center", marginBottom: "22px", position: "relative", zIndex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", marginBottom: "4px" }}>
                          <FoodishLogo size={34} />
                          <span style={{ fontSize: "26px", fontWeight: "900", letterSpacing: "2px", color: "#10b981" }}>FOODISH</span>
                        </div>
                        <h1 style={{ fontSize: "26px", fontWeight: "900", color: "#0f172a", margin: "0 0 6px", textTransform: "uppercase" }}>
                          {displayData.restaurantName} — Restaurant Statement
                        </h1>
                        <p style={{ fontSize: "14px", fontWeight: "700", color: "#475569", margin: 0 }}>
                          From Date: {displayData.fromDate} To Date: {displayData.toDate} ({displayData.deliveredCount} Delivered Orders)
                        </p>
                      </div>

                      <div
                        style={{
                          background: "linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%)",
                          border: "2.5px solid #10b981",
                          borderRadius: "16px",
                          padding: "22px",
                          marginBottom: "20px",
                          position: "relative",
                          zIndex: 1,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "14px" }}>
                          <div>
                            <div style={{ fontSize: "11px", fontWeight: "800", color: "#047857", letterSpacing: "0.8px", textTransform: "uppercase" }}>
                              FROM {displayData.fromDate} TO {displayData.toDate}
                            </div>
                            <div style={{ fontSize: "18px", fontWeight: "900", color: "#0f172a", marginTop: "6px" }}>
                              {activeBaseLabel}: <span style={{ color: "#047857", fontSize: "22px" }}>{money(displayData.baseTotal)}</span>
                            </div>
                          </div>

                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: "11px", fontWeight: "800", color: "#065f46", textTransform: "uppercase" }}>
                              NET FINAL PAYABLE TOTAL
                            </div>
                            <div style={{ fontSize: "34px", fontWeight: "900", color: "#14532d", lineHeight: "1.15" }}>
                              {money(displayData.netTotal)}
                            </div>
                            <div style={{ fontSize: "11px", fontWeight: "700", color: "#475569", marginTop: "3px" }}>
                              Base ({money(displayData.baseTotal)}) + Plus ({money(displayData.plusSum)}) - Minus ({money(displayData.minusSum)}) - Fine ({money(resolvedFineSum)})
                            </div>
                          </div>
                        </div>
                      </div>

                      {!isLockedView && (
                        <div
                          className="print-hide"
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "16px",
                            marginBottom: "22px",
                          }}
                        >
                          <div
                            style={{
                              background: "#f8fafc",
                              border: "1.5px solid #cbd5e1",
                              borderRadius: "14px",
                              padding: "16px",
                              display: "flex",
                              flexDirection: "column",
                              gap: "10px",
                            }}
                          >
                            <div style={{ fontSize: "14px", fontWeight: "800", color: "#0f172a" }}>
                              ➕ / ➖ Plus & Minus ({activeBaseLabel} theke jog/biyog)
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px" }}>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="Amount (৳)"
                                value={resAdjAmountInput}
                                onChange={(e) => setResAdjAmountInput(e.target.value)}
                                style={{
                                  height: "42px",
                                  borderRadius: "8px",
                                  border: "1px solid #cbd5e1",
                                  padding: "0 12px",
                                  fontSize: "15px",
                                  fontWeight: "800",
                                  background: "#ffffff",
                                }}
                              />
                              <input
                                type="text"
                                placeholder="Note likhun..."
                                value={resAdjNoteInput}
                                onChange={(e) => setResAdjNoteInput(e.target.value)}
                                style={{
                                  height: "42px",
                                  borderRadius: "8px",
                                  border: "1px solid #cbd5e1",
                                  padding: "0 12px",
                                  fontSize: "13px",
                                  background: "#ffffff",
                                }}
                              />
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                              <button
                                type="button"
                                className="primary-btn"
                                onClick={() => handleAddRestaurantAdjustment("plus")}
                                style={{ height: "42px", background: "#16a34a", fontSize: "14px" }}
                              >
                                + Plus
                              </button>
                              <button
                                type="button"
                                className="primary-btn"
                                onClick={() => handleAddRestaurantAdjustment("minus")}
                                style={{ height: "42px", background: "#ea580c", fontSize: "14px" }}
                              >
                                - Minus
                              </button>
                            </div>
                          </div>

                          <div
                            style={{
                              background: "#fef2f2",
                              border: "1.5px solid #fecaca",
                              borderRadius: "14px",
                              padding: "16px",
                              display: "flex",
                              flexDirection: "column",
                              gap: "10px",
                            }}
                          >
                            <div style={{ fontSize: "14px", fontWeight: "800", color: "#991b1b" }}>
                              ⚠️ Fine Box ({activeBaseLabel} theke minus hobe)
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px" }}>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="Fine Amount (৳)"
                                value={resFineAmountInput}
                                onChange={(e) => setResFineAmountInput(e.target.value)}
                                style={{
                                  height: "42px",
                                  borderRadius: "8px",
                                  border: "1px solid #fca5a5",
                                  padding: "0 12px",
                                  fontSize: "15px",
                                  fontWeight: "800",
                                  background: "#ffffff",
                                }}
                              />
                              <input
                                type="text"
                                placeholder="Fine Note likhun..."
                                value={resFineNoteInput}
                                onChange={(e) => setResFineNoteInput(e.target.value)}
                                style={{
                                  height: "42px",
                                  borderRadius: "8px",
                                  border: "1px solid #fca5a5",
                                  padding: "0 12px",
                                  fontSize: "13px",
                                  background: "#ffffff",
                                }}
                              />
                            </div>
                            <button
                              type="button"
                              className="primary-btn"
                              onClick={() => handleAddRestaurantAdjustment("fine")}
                              style={{ height: "42px", background: "#dc2626", fontSize: "14px" }}
                            >
                              - Minus Fine
                            </button>
                          </div>
                        </div>
                      )}

                      <div
                        className="panel"
                        style={{
                          border: "1px solid #e2e8f0",
                          padding: "16px",
                          boxShadow: "none",
                          position: "relative",
                          zIndex: 1,
                          marginBottom: "22px",
                        }}
                      >
                        <div className="panel-head" style={{ marginBottom: "12px" }}>
                          <div>
                            <h3>📋 Serial-Wise Calculation & Notes</h3>
                            <p>{activeBaseLabel} with serial-wise Plus (+), Minus (-), Fine, and Notes</p>
                          </div>
                        </div>

                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th>SL</th>
                                <th>Type</th>
                                <th>Amount</th>
                                <th>Note</th>
                                {!isLockedView && <th className="right print-hide">Action</th>}
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td><strong>1</strong></td>
                                <td>
                                  <span className="status good">{activeBaseLabel}</span>
                                </td>
                                <td><strong>{money(displayData.baseTotal)}</strong></td>
                                <td style={{ whiteSpace: "normal" }}>
                                  {activeBaseLabel} from {displayData.fromDate} to {displayData.toDate}
                                </td>
                                {!isLockedView && <td className="right print-hide">—</td>}
                              </tr>

                              {(displayData.adjustments || []).map((adj, idx) => {
                                const serialNum = 2 + idx;
                                const isPlus = adj.type === "plus";
                                const isFine = adj.type === "fine";
                                return (
                                  <tr key={adj.id}>
                                    <td><strong>{serialNum}</strong></td>
                                    <td>
                                      <span className={`status ${isPlus ? "good" : "bad"}`}>
                                        {isPlus ? "+ Plus" : isFine ? "Fine (-)" : "- Minus"}
                                      </span>
                                    </td>
                                    <td>
                                      <strong style={{ color: isPlus ? "#16a34a" : "#dc2626" }}>
                                        {isPlus ? "+" : "-"} {money(adj.amount)}
                                      </strong>
                                    </td>
                                    <td style={{ whiteSpace: "normal" }}>{adj.note || "—"}</td>
                                    {!isLockedView && (
                                      <td className="right print-hide">
                                        <button
                                          type="button"
                                          className="delete-btn"
                                          style={{ padding: "5px 10px", fontSize: "11px" }}
                                          onClick={() => handleRemoveRestaurantAdjustment(adj.id)}
                                        >
                                          Remove
                                        </button>
                                      </td>
                                    )}
                                  </tr>
                                );
                              })}
                            </tbody>
                            <tfoot>
                              <tr>
                                <th colSpan={2}>FINAL NET PAYABLE TOTAL</th>
                                <th colSpan={!isLockedView ? 3 : 2} style={{ fontSize: "16px", color: "#14532d" }}>
                                  {money(displayData.netTotal)}
                                </th>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </div>

                      <div
                        className="panel"
                        style={{
                          background: "#ffffff",
                          border: "1px solid #cbd5e1",
                          borderRadius: "14px",
                          padding: "18px",
                          boxShadow: "none",
                          position: "relative",
                          zIndex: 1,
                        }}
                      >
                        <div className="panel-head" style={{ marginBottom: "12px" }}>
                          <div>
                            <h3>🚨 Date-Wise Order Notes ({displayData.fromDate} to {displayData.toDate})</h3>
                            <p>
                              All orders with notes for {displayData.restaurantName} ·{" "}
                              <strong style={{ color: "#2563eb" }}>
                                (Click kore dhore rakhle full order details dekhabe)
                              </strong>
                            </p>
                          </div>
                          <span className="count-pill">{(displayData.orderNotes || []).length} order notes</span>
                        </div>

                        {(displayData.orderNotes || []).length > 0 ? (
                          <div className="table-wrap">
                            <table>
                              <thead>
                                <tr>
                                  <th>#</th>
                                  <th>Date</th>
                                  <th>Order ID</th>
                                  <th>Order Status</th>
                                  <th>Order Note (Hold for Full Details)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(displayData.orderNotes || []).map((item, idx) => (
                                  <tr
                                    key={item.id || idx}
                                    className="holdable-note-row"
                                    title="Click and hold to view full order details"
                                    onMouseDown={() => startNoteLongPress(item)}
                                    onMouseUp={cancelNoteLongPress}
                                    onMouseLeave={cancelNoteLongPress}
                                    onTouchStart={() => startNoteLongPress(item)}
                                    onTouchEnd={cancelNoteLongPress}
                                    onTouchCancel={cancelNoteLongPress}
                                    onContextMenu={(e) => {
                                      e.preventDefault();
                                      setOrderDetailModal(item);
                                    }}
                                  >
                                    <td><strong>{idx + 1}</strong></td>
                                    <td><strong>{item.date}</strong></td>
                                    <td><strong>#{item.orderId}</strong></td>
                                    <td>
                                      <span
                                        className={`status ${
                                          item.isDelivered ? "good" : item.isCancelled ? "bad" : "pending"
                                        }`}
                                      >
                                        {item.status}
                                      </span>
                                    </td>
                                    <td style={{ whiteSpace: "normal", color: "#b91c1c", fontWeight: "800" }}>
                                      {item.note}{" "}
                                      <span
                                        className="print-hide"
                                        style={{
                                          fontSize: "10px",
                                          background: "#eff6ff",
                                          color: "#1d4ed8",
                                          padding: "2px 7px",
                                          borderRadius: "6px",
                                          marginLeft: "6px",
                                          fontWeight: "700",
                                        }}
                                      >
                                        Hold to View Order
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div style={{ textAlign: "center", color: "#9aa5b5", padding: "20px", fontSize: "13px" }}>
                            No order notes found between {displayData.fromDate} and {displayData.toDate}.
                          </div>
                        )}
                      </div>

                      {!isLockedView && (
                        <div
                          className="print-hide"
                          style={{
                            marginTop: "22px",
                            padding: "18px",
                            background: "#f8fafc",
                            border: "2px dashed #10b981",
                            borderRadius: "14px",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: "12px",
                          }}
                        >
                          <div>
                            <strong style={{ fontSize: "14px", color: "#0f172a", display: "block" }}>
                              Save Permanent Statement for {displayData.restaurantName} ({displayData.fromDate} to {displayData.toDate})
                            </strong>
                            <span style={{ fontSize: "12px", color: "#64748b" }}>
                              Once saved to database, this statement will be permanently locked and downloadable/printable anytime.
                            </span>
                          </div>
                          <button
                            type="button"
                            className="primary-btn"
                            disabled={saving || !selectedRestaurant}
                            onClick={saveRestaurantStatementToDatabase}
                            style={{ height: "46px", padding: "0 24px", background: "#059669", fontSize: "14px" }}
                          >
                            💾 Save Statement to Database
                          </button>
                        </div>
                      )}

                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "60px", paddingTop: "16px", position: "relative", zIndex: 1 }}>
                        <div style={{ textAlign: "center", width: "200px" }}>
                          <div style={{ borderTop: "2px solid #0f172a", marginBottom: "6px" }} />
                          <strong style={{ fontSize: "13px", color: "#0f172a" }}>Restaurant Owner Sign</strong>
                        </div>
                        <div style={{ textAlign: "center", width: "200px" }}>
                          <div style={{ borderTop: "2px solid #0f172a", marginBottom: "6px" }} />
                          <strong style={{ fontSize: "13px", color: "#0f172a" }}>Manager Sign</strong>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </section>
        )}

        {/* 4. RIDERS PAGE */}
        {page === "riders" && (
          <section key="page-riders" className="content page-animate">
            <div className="section-heading print-hide" style={{ marginBottom: "14px" }}>
              <div>
                <h2>Rider accounts & Orders</h2>
                <p>View rider-specific daily entries, orders, or date-range summary with PDF download & notes.</p>
              </div>
            </div>

            <div
              className="tabs print-hide"
              style={{
                background: "#ffffff",
                padding: "6px 10px 0",
                borderRadius: "12px",
                border: "1px solid #e2e8f0",
                marginBottom: "18px",
                gap: "8px",
              }}
            >
              <button
                type="button"
                className={riderTab === "daily" ? "selected" : ""}
                onClick={() => setRiderTab("daily")}
                style={{ fontSize: "13px", padding: "10px 18px" }}
              >
                📋 Daily Accounts & Orders
              </button>
              <button
                type="button"
                className={riderTab === "summary" ? "selected" : ""}
                onClick={() => setRiderTab("summary")}
                style={{ fontSize: "13px", padding: "10px 18px" }}
              >
                📊 Summary (Date Range)
              </button>
            </div>

            {/* TAB 1: DAILY ACCOUNTS & ORDERS */}
            {riderTab === "daily" && (
              <div key="rider-tab-daily" className="tab-pane-animate">
                <div className="filter-bar">
                  <label>
                    Rider
                    <select value={riderId} onChange={(e) => setRiderId(e.target.value)}>
                      {riders.map((r) => (
                        <option key={r.id} value={r.id}>{r.name || r.id}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Filter Date
                    <input type="date" value={riderPageDate} onChange={(e) => setRiderPageDate(e.target.value)} />
                  </label>
                  <label>
                    Order Status Filter
                    <select value={riderPageStatus} onChange={(e) => setRiderPageStatus(e.target.value)}>
                      <option value="all">All Orders</option>
                      <option value="delivered">Delivered Only</option>
                      <option value="pending">Pending / Processing</option>
                      <option value="on_the_way">On The Way</option>
                      <option value="cancelled">Cancelled Only</option>
                    </select>
                  </label>
                  <label style={{ flex: 2 }}>
                    Search Orders (Order ID, Customer Name, Phone, Restaurant)
                    <input
                      type="text"
                      value={riderPageSearch}
                      onChange={(e) => setRiderPageSearch(e.target.value)}
                      placeholder="Search in rider orders..."
                    />
                  </label>
                </div>

                <div
                  className="panel"
                  style={{
                    background: "#ffffff",
                    border: "2px solid #10b981",
                    borderRadius: "16px",
                    padding: "22px",
                    marginBottom: "20px",
                    boxShadow: "0 4px 16px rgba(16, 185, 129, 0.08)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      borderBottom: "1px solid #e2e8f0",
                      paddingBottom: "12px",
                      marginBottom: "18px",
                      flexWrap: "wrap",
                      gap: "10px",
                    }}
                  >
                    <div>
                      <span style={{ fontSize: "11px", fontWeight: "800", color: "#059669", letterSpacing: "0.8px" }}>
                        RIDER DELIVERY SUMMARY ({riderPageDate})
                      </span>
                      <h3 style={{ margin: "4px 0 0", fontSize: "18px", fontWeight: "800", color: "#0f172a" }}>
                        {selectedRider?.name || "Selected Rider"} — Account Summary
                      </h3>
                    </div>
                    <span
                      style={{
                        background: "#fff0ef",
                        color: "#dc2626",
                        padding: "6px 12px",
                        borderRadius: "20px",
                        fontSize: "12px",
                        fontWeight: "800",
                      }}
                    >
                      Cancelled: {money(riderPageStats.cancelledTotal)}
                    </span>
                  </div>

                  <div style={{ display: "grid", gap: "12px" }}>
                    {[
                      {
                        label: "Delivered COD Total",
                        val: money(riderPageStats.deliveredCod),
                        border: "#10b981",
                        bg: "#ecfdf5",
                        color: "#065f46",
                      },
                      {
                        label: "Delivered Online Total",
                        val: money(riderPageStats.deliveredOnline),
                        border: "#3b82f6",
                        bg: "#eff6ff",
                        color: "#1e40af",
                      },
                      {
                        label: "Total Amount (COD + Online)",
                        val: money(riderPageStats.deliveredTotal),
                        border: "#8b5cf6",
                        bg: "#f5f3ff",
                        color: "#5b21b6",
                      },
                      {
                        label: "Delivery Charge",
                        val: money(riderPageStats.totalCharge),
                        border: "#f59e0b",
                        bg: "#fffbeb",
                        color: "#92400e",
                      },
                    ].map((row) => (
                      <div
                        key={row.label}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "12px 16px",
                          background: "#f8fafc",
                          borderRadius: "10px",
                          border: "1px solid #e2e8f0",
                          flexWrap: "wrap",
                          gap: "10px",
                        }}
                      >
                        <span style={{ fontSize: "15px", fontWeight: "800", color: "#1e293b" }}>
                          {row.label}
                        </span>
                        <input
                          type="text"
                          readOnly
                          value={row.val}
                          style={{
                            width: "160px",
                            textAlign: "right",
                            padding: "8px 12px",
                            borderRadius: "8px",
                            border: `2px solid ${row.border}`,
                            background: row.bg,
                            color: row.color,
                            fontSize: "16px",
                            fontWeight: "900",
                            outline: "none",
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(195px, 1fr))",
                    gap: "14px",
                    marginBottom: "20px",
                  }}
                >
                  {[
                    { key: "collection", label: "Cash Collect", color: "#10b981", bg: "#ecfdf5" },
                    { key: "bkash", label: "bKash", color: "#ec4899", bg: "#fdf2f8" },
                    { key: "nagad", label: "Nagad", color: "#f97316", bg: "#fff7ed" },
                    { key: "fine", label: "Fine", color: "#ef4444", bg: "#fef2f2" },
                    { key: "salary", label: "Salary", color: "#16a34a", bg: "#f0fdf4" },
                    { key: "payment", label: "Payment", color: "#3b82f6", bg: "#eff6ff" },
                  ].map((item) => (
                    <div
                      key={item.key}
                      className="panel"
                      style={{
                        margin: 0,
                        padding: "16px",
                        borderRadius: "14px",
                        border: `2px solid ${item.color}`,
                        background: "#ffffff",
                        display: "flex",
                        flexDirection: "column",
                        gap: "10px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: "13px", fontWeight: "800", color: "#0f172a", textTransform: "uppercase" }}>
                          {item.label}
                        </span>
                        <span style={{ fontSize: "10px", fontWeight: "700", color: "#64748b" }}>
                          {riderPageDate}
                        </span>
                      </div>

                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={riderInputs[item.key]}
                        onChange={(e) =>
                          setRiderInputs((prev) => ({ ...prev, [item.key]: e.target.value }))
                        }
                        style={{
                          width: "100%",
                          height: "42px",
                          padding: "0 12px",
                          borderRadius: "8px",
                          border: "1px solid #cbd5e1",
                          background: item.bg,
                          fontSize: "16px",
                          fontWeight: "800",
                          color: "#0f172a",
                          outline: "none",
                        }}
                      />

                      <button
                        type="button"
                        className="primary-btn"
                        disabled={saving || !riderId}
                        onClick={() =>
                          handleUpdateManagementEntry({
                            entityType: "rider",
                            entityId: riderId,
                            entityName: selectedRider?.name || "Rider",
                            type: item.key,
                            amount: Number(riderInputs[item.key] || 0),
                            date: riderPageDate,
                          })
                        }
                        style={{
                          width: "100%",
                          height: "36px",
                          background: item.color,
                          fontSize: "12px",
                          fontWeight: "800",
                        }}
                      >
                        💾 Save {item.label}
                      </button>
                    </div>
                  ))}
                </div>

                <div
                  className="panel"
                  style={{
                    background: isRiderChecked ? "#f0fdf4" : "#ffffff",
                    border: isRiderChecked ? "2px solid #16a34a" : "1px solid #cbd5e1",
                    borderRadius: "14px",
                    padding: "18px",
                    marginBottom: "20px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px", flexWrap: "wrap", gap: "8px" }}>
                    <span style={{ fontSize: "13px", fontWeight: "800", color: "#0f172a" }}>
                      📝 Rider Daily Note ({riderPageDate})
                    </span>
                    <span style={{ fontSize: "11px", color: "#64748b", fontWeight: "700" }}>
                      {selectedRider?.name || "Selected Rider"}
                    </span>
                  </div>

                  <textarea
                    rows={3}
                    value={riderInputs.note}
                    onChange={(e) => setRiderInputs((prev) => ({ ...prev, note: e.target.value }))}
                    placeholder="Write any note for this rider on this date..."
                    style={{
                      width: "100%",
                      padding: "12px",
                      borderRadius: "10px",
                      border: "1px solid #cbd5e1",
                      fontSize: "13px",
                      fontFamily: "inherit",
                      color: "#0f172a",
                      outline: "none",
                      marginBottom: "12px",
                      resize: "vertical",
                      background: "#ffffff",
                    }}
                  />

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
                    <label
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "10px",
                        padding: "9px 16px",
                        borderRadius: "10px",
                        border: isRiderChecked ? "2px solid #16a34a" : "2px solid #cbd5e1",
                        background: isRiderChecked ? "#dcfce7" : "#f8fafc",
                        cursor: "pointer",
                        userSelect: "none",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isRiderChecked}
                        disabled={saving || !riderId}
                        onChange={(e) =>
                          handleUpdateManagementEntry({
                            entityType: "rider",
                            entityId: riderId,
                            entityName: selectedRider?.name || "Rider",
                            type: "rider_checked",
                            amount: e.target.checked ? 1 : 0,
                            date: riderPageDate,
                          })
                        }
                        style={{ width: "20px", height: "20px", accentColor: "#16a34a", cursor: "pointer" }}
                      />
                      <span style={{ fontSize: "13px", fontWeight: "900", color: isRiderChecked ? "#14532d" : "#334155" }}>
                        {isRiderChecked
                          ? `✓ Checked on ${riderPageDate}`
                          : `Mark as Checked (${riderPageDate})`}
                      </span>
                    </label>

                    <button
                      type="button"
                      className="primary-btn"
                      disabled={saving || !riderId}
                      onClick={() =>
                        handleUpdateManagementEntry({
                          entityType: "rider",
                          entityId: riderId,
                          entityName: selectedRider?.name || "Rider",
                          type: "rider_note",
                          amount: 0,
                          note: riderInputs.note,
                          date: riderPageDate,
                        })
                      }
                      style={{ height: "40px", padding: "0 20px", background: "#0f172a" }}
                    >
                      💾 Save Note
                    </button>
                  </div>
                </div>

                <div className="panel">
                  <div className="panel-head">
                    <div>
                      <h3>Rider Orders ({riderPageOrders.length})</h3>
                      <p>Detailed breakdown including full items grouped by restaurants and order note</p>
                    </div>
                  </div>

                  <div className="table-wrap universal-card-list">
                    <table>
                      <thead>
                        <tr>
                          <th>Order ID</th>
                          <th>Customer</th>
                          <th>Full Order Items & Restaurants</th>
                          <th>Time</th>
                          <th>Payment</th>
                          <th>Status</th>
                          <th className="right">Total Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {riderPageOrders.map((order, idx) => {
                          const orderNote = order.note || order.orderNote || order.instructions || "";
                          const borderColors = ["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ec4899", "#06b6d4"];
                          const cardBorderColor = borderColors[idx % borderColors.length];

                          return (
                            <tr key={order.id} style={{ "--card-border-color": cardBorderColor }}>
                              <td data-label="Order ID">
                                <strong>#{order.orderId || order.id.slice(0, 8)}</strong>
                              </td>
                              <td data-label="Customer">
                                <div className="card-value-block">
                                  <strong>{order.userName || "—"}</strong>
                                  <small className="cell-sub">{order.userPhone || ""}</small>
                                </div>
                              </td>
                              <td data-label="Full Order Items & Restaurants">
                                <div className="card-value-block">
                                  <OrderItemsBreakdown items={order.items} />
                                  {orderNote && (
                                    <div
                                      style={{
                                        marginTop: "10px",
                                        padding: "10px 14px",
                                        background: "#fef2f2",
                                        border: "2px solid #ef4444",
                                        borderRadius: "10px",
                                        color: "#b91c1c",
                                        fontWeight: "900",
                                        fontSize: "15px",
                                        lineHeight: "1.5",
                                        boxShadow: "0 2px 6px rgba(239,68,68,0.15)",
                                      }}
                                    >
                                      🚨 <span style={{ textDecoration: "underline" }}>ORDER NOTE</span>: {orderNote}
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td data-label="Time">{formatDateTime(order.createdAt)}</td>
                              <td data-label="Payment">
                                <span style={{ fontWeight: "700" }}>{order.payment || order.paymentMethod || "—"}</span>
                              </td>
                              <td data-label="Status">
                                <span className={`status ${isDelivered(order) ? "good" : isCancelled(order) ? "bad" : "pending"}`}>
                                  {order.orderStatus || "Pending"}
                                </span>
                              </td>
                              <td data-label="Total Price" className="right">
                                <strong style={{ fontSize: "16px", color: "#0f172a" }}>{money(orderAmount(order))}</strong>
                              </td>
                            </tr>
                          );
                        })}
                        {riderPageOrders.length === 0 && (
                          <tr>
                            <td colSpan={7} className="empty-cell">No orders found matching your search and filters.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: RIDER DATE-RANGE SUMMARY */}
            {riderTab === "summary" && (
              <div key="rider-tab-summary" className="tab-pane-animate">
                <div className="filter-bar print-hide">
                  <label>
                    Rider
                    <select value={riderId} onChange={(e) => setRiderId(e.target.value)}>
                      {riders.map((r) => (
                        <option key={r.id} value={r.id}>{r.name || r.id}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    From Date
                    <input
                      type="date"
                      value={riderSummaryStart}
                      onChange={(e) => setRiderSummaryStart(e.target.value)}
                    />
                  </label>
                  <label>
                    To Date
                    <input
                      type="date"
                      value={riderSummaryEnd}
                      min={riderSummaryStart}
                      onChange={(e) => setRiderSummaryEnd(e.target.value)}
                    />
                  </label>
                  <div style={{ display: "flex", gap: "10px", alignItems: "flex-end", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="primary-btn"
                      onClick={() =>
                        handlePrintReport(
                          `${selectedRider?.name || "Rider"}_${riderSummaryStart}_to_${riderSummaryEnd}`
                        )
                      }
                      style={{ height: "38px", padding: "0 16px", background: "#3b82f6" }}
                    >
                      🖨️ Print / Download PDF
                    </button>
                  </div>
                </div>

                {firestoreRiderStatements.length > 0 && (
                  <div className="panel print-hide">
                    <div className="panel-head">
                      <div>
                        <h3>🔒 Saved Rider Statements Archive (Permanent & Locked)</h3>
                        <p>Once saved, statements cannot be modified. View, Print PDF, Download CSV, or Delete anytime.</p>
                      </div>
                      <span className="count-pill">{firestoreRiderStatements.length} saved</span>
                    </div>

                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Rider Name</th>
                            <th>From Date → To Date</th>
                            <th>Total COD Cash</th>
                            <th>Net Total</th>
                            <th>Saved At</th>
                            <th className="right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...firestoreRiderStatements]
                            .sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")))
                            .map((st) => (
                              <tr key={st.id}>
                                <td><strong>{st.riderName}</strong></td>
                                <td>{st.fromDate} to {st.toDate}</td>
                                <td><strong>{money(st.baseTotal)}</strong></td>
                                <td>
                                  <strong style={{ color: "#047857", fontSize: "15px" }}>
                                    {money(st.netTotal)}
                                  </strong>
                                </td>
                                <td>{formatDateTime(st.savedAt)}</td>
                                <td className="right" style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                                  <button
                                    type="button"
                                    className="primary-btn"
                                    style={{ height: "32px", padding: "0 12px", fontSize: "11px", background: "#059669" }}
                                    onClick={() => setActiveSavedRiderStatement(st)}
                                  >
                                    👁️ View / Print
                                  </button>
                                  <button
                                    type="button"
                                    className="primary-btn"
                                    style={{ height: "32px", padding: "0 12px", fontSize: "11px", background: "#2563eb" }}
                                    onClick={() => downloadRiderStatementCSV(st)}
                                  >
                                    📥 CSV
                                  </button>
                                  <button
                                    type="button"
                                    className="delete-btn"
                                    style={{ height: "32px", padding: "0 12px", fontSize: "11px" }}
                                    onClick={() => deleteSavedRiderStatement(st.id)}
                                  >
                                    🗑️ Delete
                                  </button>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {(() => {
                  const isLockedView = Boolean(activeSavedRiderStatement);
                  const displayData = isLockedView
                    ? activeSavedRiderStatement
                    : {
                        riderName: selectedRider?.name || "Selected Rider",
                        fromDate: riderSummaryStart,
                        toDate: riderSummaryEnd,
                        deliveredCount: riderRangeSummary.deliveredCount,
                        baseTotal: riderSummaryCalculation.baseTotal,
                        plusSum: riderSummaryCalculation.plusSum,
                        minusSum: riderSummaryCalculation.minusSum,
                        fineSum: riderSummaryCalculation.fineSum ?? riderSummaryCalculation.totalFine ?? 0,
                        netTotal: riderSummaryCalculation.netTotal,
                        adjustments: riderAdjustments,
                        orderNotes: riderRangeSummary.orderNotesList,
                      };

                  const resolvedFineSum = Number(displayData.fineSum ?? displayData.totalFine ?? 0);

                  return (
                    <div
                      className="printable-report-area history-print-box"
                      style={{
                        background: "#ffffff",
                        padding: "26px",
                        borderRadius: "16px",
                        border: isLockedView ? "2px solid #059669" : "1px solid #e2e8f0",
                        position: "relative",
                      }}
                    >
                      <div
                        className="pdf-watermark-logo"
                        style={{
                          display: "none",
                          position: "absolute",
                          top: "50%",
                          left: "50%",
                          transform: "translate(-50%, -50%)",
                          opacity: 0.05,
                          pointerEvents: "none",
                          zIndex: 0,
                        }}
                      >
                        <FoodishLogo size={360} />
                      </div>

                      {isLockedView && (
                        <div
                          className="print-hide"
                          style={{
                            background: "#ecfdf5",
                            border: "1px solid #10b981",
                            borderRadius: "10px",
                            padding: "12px 16px",
                            marginBottom: "18px",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: "10px",
                          }}
                        >
                          <div style={{ fontSize: "13px", fontWeight: "800", color: "#065f46" }}>
                            🔒 Viewing Permanently Saved Statement (Read-Only / Locked)
                          </div>
                          <div style={{ display: "flex", gap: "8px" }}>
                            <button
                              type="button"
                              className="primary-btn"
                              style={{ height: "34px", padding: "0 14px", fontSize: "12px", background: "#3b82f6" }}
                              onClick={() =>
                                handlePrintReport(
                                  `${displayData.riderName}_${displayData.fromDate}_to_${displayData.toDate}`
                                )
                              }
                            >
                              🖨️ Print / PDF
                            </button>
                            <button
                              type="button"
                              className="primary-btn"
                              style={{ height: "34px", padding: "0 14px", fontSize: "12px", background: "#2563eb" }}
                              onClick={() => downloadRiderStatementCSV(displayData)}
                            >
                              📥 Download CSV
                            </button>
                            <button
                              type="button"
                              className="primary-btn"
                              style={{ height: "34px", padding: "0 14px", fontSize: "12px", background: "#64748b" }}
                              onClick={() => setActiveSavedRiderStatement(null)}
                            >
                              ✕ Close Saved View
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="print-header" style={{ textAlign: "center", marginBottom: "22px", position: "relative", zIndex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", marginBottom: "4px" }}>
                          <FoodishLogo size={34} />
                          <span style={{ fontSize: "26px", fontWeight: "900", letterSpacing: "2px", color: "#10b981" }}>FOODISH</span>
                        </div>
                        <h1 style={{ fontSize: "26px", fontWeight: "900", color: "#0f172a", margin: "0 0 6px", textTransform: "uppercase" }}>
                          {displayData.riderName} — COD Cash Statement
                        </h1>
                        <p style={{ fontSize: "14px", fontWeight: "700", color: "#475569", margin: 0 }}>
                          From Date: {displayData.fromDate} To Date: {displayData.toDate} ({displayData.deliveredCount} Delivered COD Orders)
                        </p>
                      </div>

                      <div
                        style={{
                          background: "linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%)",
                          border: "2.5px solid #10b981",
                          borderRadius: "16px",
                          padding: "22px",
                          marginBottom: "20px",
                          position: "relative",
                          zIndex: 1,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "14px" }}>
                          <div>
                            <div style={{ fontSize: "11px", fontWeight: "800", color: "#047857", letterSpacing: "0.8px", textTransform: "uppercase" }}>
                              FROM {displayData.fromDate} TO {displayData.toDate}
                            </div>
                            <div style={{ fontSize: "18px", fontWeight: "900", color: "#0f172a", marginTop: "6px" }}>
                              Total COD Cash Amount: <span style={{ color: "#047857", fontSize: "22px" }}>{money(displayData.baseTotal)}</span>
                            </div>
                          </div>

                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: "11px", fontWeight: "800", color: "#065f46", textTransform: "uppercase" }}>
                              NET FINAL COD CASH TOTAL
                            </div>
                            <div style={{ fontSize: "34px", fontWeight: "900", color: "#14532d", lineHeight: "1.15" }}>
                              {money(displayData.netTotal)}
                            </div>
                            <div style={{ fontSize: "11px", fontWeight: "700", color: "#475569", marginTop: "3px" }}>
                              Total COD ({money(displayData.baseTotal)}) + Plus ({money(displayData.plusSum)}) - Minus ({money(displayData.minusSum)}) - Fine ({money(resolvedFineSum)})
                            </div>
                          </div>
                        </div>
                      </div>

                      {!isLockedView && (
                        <div
                          className="print-hide"
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "16px",
                            marginBottom: "22px",
                          }}
                        >
                          <div
                            style={{
                              background: "#f8fafc",
                              border: "1.5px solid #cbd5e1",
                              borderRadius: "14px",
                              padding: "16px",
                              display: "flex",
                              flexDirection: "column",
                              gap: "10px",
                            }}
                          >
                            <div style={{ fontSize: "14px", fontWeight: "800", color: "#0f172a" }}>
                              ➕ / ➖ Plus & Minus (Total COD Cash Amount theke jog/biyog)
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px" }}>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="Amount (৳)"
                                value={adjAmountInput}
                                onChange={(e) => setAdjAmountInput(e.target.value)}
                                style={{
                                  height: "42px",
                                  borderRadius: "8px",
                                  border: "1px solid #cbd5e1",
                                  padding: "0 12px",
                                  fontSize: "15px",
                                  fontWeight: "800",
                                  background: "#ffffff",
                                }}
                              />
                              <input
                                type="text"
                                placeholder="Note likhun..."
                                value={adjNoteInput}
                                onChange={(e) => setAdjNoteInput(e.target.value)}
                                style={{
                                  height: "42px",
                                  borderRadius: "8px",
                                  border: "1px solid #cbd5e1",
                                  padding: "0 12px",
                                  fontSize: "13px",
                                  background: "#ffffff",
                                }}
                              />
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                              <button
                                type="button"
                                className="primary-btn"
                                onClick={() => handleAddRiderAdjustment("plus")}
                                style={{ height: "42px", background: "#16a34a", fontSize: "14px" }}
                              >
                                + Plus
                              </button>
                              <button
                                type="button"
                                className="primary-btn"
                                onClick={() => handleAddRiderAdjustment("minus")}
                                style={{ height: "42px", background: "#ea580c", fontSize: "14px" }}
                              >
                                - Minus
                              </button>
                            </div>
                          </div>

                          <div
                            style={{
                              background: "#fef2f2",
                              border: "1.5px solid #fecaca",
                              borderRadius: "14px",
                              padding: "16px",
                              display: "flex",
                              flexDirection: "column",
                              gap: "10px",
                            }}
                          >
                            <div style={{ fontSize: "14px", fontWeight: "800", color: "#991b1b" }}>
                              ⚠️ Fine Box (Total COD Cash Amount theke minus hobe)
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px" }}>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="Fine Amount (৳)"
                                value={fineAmountInput}
                                onChange={(e) => setFineAmountInput(e.target.value)}
                                style={{
                                  height: "42px",
                                  borderRadius: "8px",
                                  border: "1px solid #fca5a5",
                                  padding: "0 12px",
                                  fontSize: "15px",
                                  fontWeight: "800",
                                  background: "#ffffff",
                                }}
                              />
                              <input
                                type="text"
                                placeholder="Fine Note likhun..."
                                value={fineNoteInput}
                                onChange={(e) => setFineNoteInput(e.target.value)}
                                style={{
                                  height: "42px",
                                  borderRadius: "8px",
                                  border: "1px solid #fca5a5",
                                  padding: "0 12px",
                                  fontSize: "13px",
                                  background: "#ffffff",
                                }}
                              />
                            </div>
                            <button
                              type="button"
                              className="primary-btn"
                              onClick={() => handleAddRiderAdjustment("fine")}
                              style={{ height: "42px", background: "#dc2626", fontSize: "14px" }}
                            >
                              - Minus Fine
                            </button>
                          </div>
                        </div>
                      )}

                      <div
                        className="panel"
                        style={{
                          border: "1px solid #e2e8f0",
                          padding: "16px",
                          boxShadow: "none",
                          position: "relative",
                          zIndex: 1,
                          marginBottom: "22px",
                        }}
                      >
                        <div className="panel-head" style={{ marginBottom: "12px" }}>
                          <div>
                            <h3>📋 Serial-Wise COD Cash Calculation & Notes</h3>
                            <p>Total COD Cash Amount with serial-wise Plus (+), Minus (-), Fine, and Notes</p>
                          </div>
                        </div>

                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th>SL</th>
                                <th>Type</th>
                                <th>Amount</th>
                                <th>Note</th>
                                {!isLockedView && <th className="right print-hide">Action</th>}
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td><strong>1</strong></td>
                                <td>
                                  <span className="status good">Total COD Cash Amount</span>
                                </td>
                                <td><strong>{money(displayData.baseTotal)}</strong></td>
                                <td style={{ whiteSpace: "normal" }}>
                                  Total delivered COD cash from {displayData.fromDate} to {displayData.toDate}
                                </td>
                                {!isLockedView && <td className="right print-hide">—</td>}
                              </tr>

                              {(displayData.adjustments || []).map((adj, idx) => {
                                const serialNum = 2 + idx;
                                const isPlus = adj.type === "plus";
                                const isFine = adj.type === "fine";
                                return (
                                  <tr key={adj.id}>
                                    <td><strong>{serialNum}</strong></td>
                                    <td>
                                      <span className={`status ${isPlus ? "good" : "bad"}`}>
                                        {isPlus ? "+ Plus" : isFine ? "Fine (-)" : "- Minus"}
                                      </span>
                                    </td>
                                    <td>
                                      <strong style={{ color: isPlus ? "#16a34a" : "#dc2626" }}>
                                        {isPlus ? "+" : "-"} {money(adj.amount)}
                                      </strong>
                                    </td>
                                    <td style={{ whiteSpace: "normal" }}>{adj.note || "—"}</td>
                                    {!isLockedView && (
                                      <td className="right print-hide">
                                        <button
                                          type="button"
                                          className="delete-btn"
                                          style={{ padding: "5px 10px", fontSize: "11px" }}
                                          onClick={() => handleRemoveRiderAdjustment(adj.id)}
                                        >
                                          Remove
                                        </button>
                                      </td>
                                    )}
                                  </tr>
                                );
                              })}
                            </tbody>
                            <tfoot>
                              <tr>
                                <th colSpan={2}>FINAL NET COD CASH TOTAL</th>
                                <th colSpan={!isLockedView ? 3 : 2} style={{ fontSize: "16px", color: "#14532d" }}>
                                  {money(displayData.netTotal)}
                                </th>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </div>

                      <div
                        className="panel"
                        style={{
                          background: "#ffffff",
                          border: "1px solid #cbd5e1",
                          borderRadius: "14px",
                          padding: "18px",
                          boxShadow: "none",
                          position: "relative",
                          zIndex: 1,
                        }}
                      >
                        <div className="panel-head" style={{ marginBottom: "12px" }}>
                          <div>
                            <h3>🚨 Date-Wise Order Notes ({displayData.fromDate} to {displayData.toDate})</h3>
                            <p>
                              All orders with notes assigned to {displayData.riderName} ·{" "}
                              <strong style={{ color: "#2563eb" }}>
                                (Click kore dhore rakhle full order details dekhabe)
                              </strong>
                            </p>
                          </div>
                          <span className="count-pill">{(displayData.orderNotes || []).length} order notes</span>
                        </div>

                        {(displayData.orderNotes || []).length > 0 ? (
                          <div className="table-wrap">
                            <table>
                              <thead>
                                <tr>
                                  <th>#</th>
                                  <th>Date</th>
                                  <th>Order ID</th>
                                  <th>Order Status</th>
                                  <th>Order Note (Hold for Full Details)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(displayData.orderNotes || []).map((item, idx) => (
                                  <tr
                                    key={item.id || idx}
                                    className="holdable-note-row"
                                    title="Click and hold to view full order details"
                                    onMouseDown={() => startNoteLongPress(item)}
                                    onMouseUp={cancelNoteLongPress}
                                    onMouseLeave={cancelNoteLongPress}
                                    onTouchStart={() => startNoteLongPress(item)}
                                    onTouchEnd={cancelNoteLongPress}
                                    onTouchCancel={cancelNoteLongPress}
                                    onContextMenu={(e) => {
                                      e.preventDefault();
                                      setOrderDetailModal(item);
                                    }}
                                  >
                                    <td><strong>{idx + 1}</strong></td>
                                    <td><strong>{item.date}</strong></td>
                                    <td><strong>#{item.orderId}</strong></td>
                                    <td>
                                      <span
                                        className={`status ${
                                          item.isDelivered ? "good" : item.isCancelled ? "bad" : "pending"
                                        }`}
                                      >
                                        {item.status}
                                      </span>
                                    </td>
                                    <td style={{ whiteSpace: "normal", color: "#b91c1c", fontWeight: "800" }}>
                                      {item.note}{" "}
                                      <span
                                        className="print-hide"
                                        style={{
                                          fontSize: "10px",
                                          background: "#eff6ff",
                                          color: "#1d4ed8",
                                          padding: "2px 7px",
                                          borderRadius: "6px",
                                          marginLeft: "6px",
                                          fontWeight: "700",
                                        }}
                                      >
                                        Hold to View Order
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div style={{ textAlign: "center", color: "#9aa5b5", padding: "20px", fontSize: "13px" }}>
                            No order notes found between {displayData.fromDate} and {displayData.toDate}.
                          </div>
                        )}
                      </div>

                      {!isLockedView && (
                        <div
                          className="print-hide"
                          style={{
                            marginTop: "22px",
                            padding: "18px",
                            background: "#f8fafc",
                            border: "2px dashed #10b981",
                            borderRadius: "14px",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: "12px",
                          }}
                        >
                          <div>
                            <strong style={{ fontSize: "14px", color: "#0f172a", display: "block" }}>
                              Save Permanent Statement for {displayData.riderName} ({displayData.fromDate} to {displayData.toDate})
                            </strong>
                            <span style={{ fontSize: "12px", color: "#64748b" }}>
                              Once saved to database, this statement will be permanently locked and downloadable/printable anytime.
                            </span>
                          </div>
                          <button
                            type="button"
                            className="primary-btn"
                            disabled={saving || !selectedRider}
                            onClick={saveRiderStatementToDatabase}
                            style={{ height: "46px", padding: "0 24px", background: "#059669", fontSize: "14px" }}
                          >
                            💾 Save Statement to Database
                          </button>
                        </div>
                      )}

                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "60px", paddingTop: "16px", position: "relative", zIndex: 1 }}>
                        <div style={{ textAlign: "center", width: "200px" }}>
                          <div style={{ borderTop: "2px solid #0f172a", marginBottom: "6px" }} />
                          <strong style={{ fontSize: "13px", color: "#0f172a" }}>Rider Sign</strong>
                        </div>
                        <div style={{ textAlign: "center", width: "200px" }}>
                          <div style={{ borderTop: "2px solid #0f172a", marginBottom: "6px" }} />
                          <strong style={{ fontSize: "13px", color: "#0f172a" }}>Manager Sign</strong>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </section>
        )}

        {/* 5. HISTORY & REPORTS */}
        {page === "history" && (
          <section key="page-history" className="content page-animate">
            <div className="section-heading">
              <div>
                <h2>History & reports</h2>
                <p>Date range-based consolidated accounts report</p>
              </div>
            </div>
            <div className="filter-bar print-hide">
              <label>
                Account type
                <select value={historyType} onChange={(e) => setHistoryType(e.target.value)}>
                  <option value="restaurant">Restaurant</option>
                  <option value="rider">Rider</option>
                  <option value="online">Online</option>
                </select>
              </label>
              {historyType === "restaurant" && (
                <label>
                  Restaurant
                  <select value={restaurantId} onChange={(e) => setRestaurantId(e.target.value)}>
                    {restaurants.map((r) => (
                      <option key={r.id} value={r.id}>{r.name || r.id}</option>
                    ))}
                  </select>
                </label>
              )}
              {historyType === "rider" && (
                <label>
                  Rider
                  <select value={riderId} onChange={(e) => setRiderId(e.target.value)}>
                    {riders.map((r) => (
                      <option key={r.id} value={r.id}>{r.name || r.id}</option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Start date
                <input type="date" value={historyStart} onChange={(e) => setHistoryStart(e.target.value)} />
              </label>
              <label>
                End date
                <input type="date" value={historyEnd} min={historyStart} onChange={(e) => setHistoryEnd(e.target.value)} />
              </label>

              <div style={{ display: "flex", gap: "10px", alignItems: "flex-end", height: "38px" }}>
                <button className="primary-btn" onClick={() => saveEntityReportArchive(historyType)} style={{ height: "38px", padding: "0 16px" }}>
                  💾 Save Permanent Report
                </button>
                <button
                  className="primary-btn"
                  onClick={() =>
                    handlePrintReport(
                      `${historyType === "restaurant" ? selectedRestaurant?.name || "Restaurant" : historyType === "rider" ? selectedRider?.name || "Rider" : "Online"}_${historyStart}_to_${historyEnd}`
                    )
                  }
                  style={{ height: "38px", padding: "0 16px", background: "#3b82f6" }}
                >
                  🖨️ PDF Print
                </button>
              </div>
            </div>

            {savedEntityReports.filter((r) => r.type === historyType).length > 0 && (
              <div className="panel print-hide">
                <div className="panel-head">
                  <div>
                    <h3>Saved {historyType === "restaurant" ? "Restaurant" : historyType === "rider" ? "Rider" : "Online"} Reports Archive</h3>
                    <p>View or delete previously saved permanent reports</p>
                  </div>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Entity Name</th>
                        <th>Date Range</th>
                        <th>Saved At</th>
                        <th className="right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {savedEntityReports
                        .filter((r) => r.type === historyType)
                        .map((rep) => (
                          <tr key={rep.id}>
                            <td><strong>{rep.entityName}</strong></td>
                            <td>{rep.startDate} to {rep.endDate}</td>
                            <td>{formatDateTime(rep.savedAt)}</td>
                            <td className="right" style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                              <button className="primary-btn" style={{ height: "30px", padding: "0 12px", fontSize: "11px" }} onClick={() => setActiveReportPrintData(rep)}>
                                👁️ View / Print
                              </button>
                              <button className="delete-btn" style={{ height: "30px", padding: "0 12px", fontSize: "11px" }} onClick={() => deleteSavedEntityReport(rep.id)}>
                                🗑️ Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {historyType === "restaurant" && (
              <div className="printable-report-area history-print-box" style={{ background: "#fff", padding: "30px", borderRadius: "14px", border: "1px solid #e2e8f0", position: "relative" }}>
                <div className="pdf-watermark-logo" style={{ display: "none", position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", opacity: 0.05, pointerEvents: "none", zIndex: 0 }}>
                  <FoodishLogo size={360} />
                </div>

                <div className="print-header" style={{ textAlign: "center", marginBottom: "30px", position: "relative", zIndex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", marginBottom: "4px" }}>
                    <FoodishLogo size={36} />
                    <span style={{ fontSize: "28px", fontWeight: "900", letterSpacing: "2px", color: "#10b981" }}>FOODISH</span>
                  </div>
                  <h1 style={{ fontSize: "32px", fontWeight: "900", color: "#0f172a", margin: "0 0 8px", textTransform: "uppercase" }}>
                    {activeReportPrintData ? activeReportPrintData.entityName : selectedRestaurant?.name || "Restaurant Report"}
                  </h1>
                  <p style={{ fontSize: "16px", fontWeight: "700", color: "#475569", margin: 0 }}>
                    Date Range: {activeReportPrintData ? activeReportPrintData.startDate : historyStart} to {activeReportPrintData ? activeReportPrintData.endDate : historyEnd}
                  </p>
                </div>

                <div className="panel" style={{ border: 0, padding: 0, boxShadow: "none", position: "relative", zIndex: 1, background: "rgba(255,255,255,0.96)" }}>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Item Sales</th>
                          <th className="right">Physical Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(activeReportPrintData ? activeReportPrintData.rows : historyRestaurantRows).map((row) => (
                          <tr key={row.date}>
                            <td><strong>{row.date}</strong></td>
                            <td>{money(row.itemSales)}</td>
                            <td className="right">{money(row.physicalAmount)}</td>
                          </tr>
                        ))}
                        {!activeReportPrintData && historyRestaurantRows.length === 0 && <EmptyRow colSpan={3} />}
                      </tbody>
                      <tfoot>
                        <tr>
                          <th>TOTAL</th>
                          <th>{money(activeReportPrintData ? activeReportPrintData.totals.itemSales : historyRestaurantTotals.itemSales)}</th>
                          <th className="right">{money(activeReportPrintData ? activeReportPrintData.totals.physicalAmount : historyRestaurantTotals.physicalAmount)}</th>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                <div style={{ marginTop: "30px", padding: "20px", background: "#f8fafc", border: "2px dashed #cbd5e1", borderRadius: "12px", textAlign: "center", position: "relative", zIndex: 1 }}>
                  <div style={{ fontSize: "14px", fontWeight: "800", color: "#64748b", letterSpacing: "1px" }}>PHYSICAL COUNT TOTAL</div>
                  <div style={{ fontSize: "40px", fontWeight: "900", color: "#0f172a", margin: "6px 0 0" }}>
                    {money(activeReportPrintData ? activeReportPrintData.totals.physicalAmount : historyRestaurantTotals.physicalAmount)}
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", marginTop: "80px", paddingTop: "20px", position: "relative", zIndex: 1 }}>
                  <div style={{ textAlign: "center", width: "220px" }}>
                    <div style={{ borderTop: "2px solid #0f172a", marginBottom: "8px" }} />
                    <strong style={{ fontSize: "14px", color: "#0f172a" }}>Restaurant Owner Sign</strong>
                  </div>
                  <div style={{ textAlign: "center", width: "220px" }}>
                    <div style={{ borderTop: "2px solid #0f172a", marginBottom: "8px" }} />
                    <strong style={{ fontSize: "14px", color: "#0f172a" }}>Manager Sign</strong>
                  </div>
                </div>

                <div style={{ marginTop: "25px", display: "flex", justifyContent: "flex-end", gap: "10px", position: "relative", zIndex: 1 }} className="print-hide">
                  <button
                    className="primary-btn"
                    onClick={() =>
                      handlePrintReport(
                        `${activeReportPrintData ? activeReportPrintData.entityName : selectedRestaurant?.name || "Restaurant"}_${activeReportPrintData ? activeReportPrintData.startDate : historyStart}_to_${activeReportPrintData ? activeReportPrintData.endDate : historyEnd}`
                      )
                    }
                    style={{ background: "#3b82f6" }}
                  >
                    🖨️ Print / Download PDF
                  </button>
                  {activeReportPrintData && (
                    <button className="primary-btn" onClick={() => setActiveReportPrintData(null)} style={{ background: "#64748b" }}>Close Archive View</button>
                  )}
                </div>
              </div>
            )}

            {historyType === "rider" && (
              <div className="printable-report-area history-print-box" style={{ background: "#fff", padding: "30px", borderRadius: "14px", border: "1px solid #e2e8f0", position: "relative" }}>
                <div className="pdf-watermark-logo" style={{ display: "none", position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", opacity: 0.05, pointerEvents: "none", zIndex: 0 }}>
                  <FoodishLogo size={360} />
                </div>

                <div className="print-header" style={{ textAlign: "center", marginBottom: "30px", position: "relative", zIndex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", marginBottom: "4px" }}>
                    <FoodishLogo size={36} />
                    <span style={{ fontSize: "28px", fontWeight: "900", letterSpacing: "2px", color: "#10b981" }}>FOODISH</span>
                  </div>
                  <h1 style={{ fontSize: "32px", fontWeight: "900", color: "#0f172a", margin: "0 0 8px", textTransform: "uppercase" }}>
                    {activeReportPrintData ? activeReportPrintData.entityName : selectedRider?.name || "Rider Report"}
                  </h1>
                  <p style={{ fontSize: "16px", fontWeight: "700", color: "#475569", margin: 0 }}>
                    Date Range: {activeReportPrintData ? activeReportPrintData.startDate : historyStart} to {activeReportPrintData ? activeReportPrintData.endDate : historyEnd}
                  </p>
                </div>

                <div className="panel" style={{ border: 0, padding: 0, boxShadow: "none", position: "relative", zIndex: 1, background: "rgba(255,255,255,0.96)" }}>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Delivered</th>
                          <th>COD Amount</th>
                          <th>Collection</th>
                          <th>Fine</th>
                          <th className="right">Salary</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(activeReportPrintData ? activeReportPrintData.rows : historyRiderRows).map((row) => (
                          <tr key={row.date}>
                            <td><strong>{row.date}</strong></td>
                            <td>{row.deliveredCount}</td>
                            <td>{money(row.deliveredCod)}</td>
                            <td>{money(row.collection)}</td>
                            <td>{money(row.fine)}</td>
                            <td className="right">{money(row.salary)}</td>
                          </tr>
                        ))}
                        {!activeReportPrintData && historyRiderRows.length === 0 && <EmptyRow colSpan={6} />}
                      </tbody>
                      <tfoot>
                        <tr>
                          <th>TOTAL</th>
                          <th>{activeReportPrintData ? activeReportPrintData.totals.deliveredCount : historyRiderTotals.deliveredCount}</th>
                          <th>{money(activeReportPrintData ? activeReportPrintData.totals.deliveredCod : historyRiderTotals.deliveredCod)}</th>
                          <th>{money(activeReportPrintData ? activeReportPrintData.totals.collection : historyRiderTotals.collection)}</th>
                          <th>{money(activeReportPrintData ? activeReportPrintData.totals.fine : historyRiderTotals.fine)}</th>
                          <th className="right">{money(activeReportPrintData ? activeReportPrintData.totals.salary : historyRiderTotals.salary)}</th>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                <div style={{ marginTop: "30px", padding: "20px", background: "#f0fdf4", border: "2px solid #bbf7d0", borderRadius: "12px", textAlign: "center", position: "relative", zIndex: 1 }}>
                  <div style={{ fontSize: "14px", fontWeight: "800", color: "#15803d", letterSpacing: "1px" }}>NET SALARY (TOTAL SALARY - FINE)</div>
                  <div style={{ fontSize: "40px", fontWeight: "900", color: "#14532d", margin: "6px 0 0" }}>
                    {money(
                      (activeReportPrintData ? activeReportPrintData.totals.salary : historyRiderTotals.salary) -
                        (activeReportPrintData ? activeReportPrintData.totals.fine : historyRiderTotals.fine)
                    )}
                  </div>
                  <div style={{ fontSize: "12px", fontWeight: "700", color: "#334155", marginTop: "4px" }}>
                    Total Salary ({money(activeReportPrintData ? activeReportPrintData.totals.salary : historyRiderTotals.salary)}) - Fine ({money(activeReportPrintData ? activeReportPrintData.totals.fine : historyRiderTotals.fine)})
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", marginTop: "80px", paddingTop: "20px", position: "relative", zIndex: 1 }}>
                  <div style={{ textAlign: "center", width: "220px" }}>
                    <div style={{ borderTop: "2px solid #0f172a", marginBottom: "8px" }} />
                    <strong style={{ fontSize: "14px", color: "#0f172a" }}>Rider Sign</strong>
                  </div>
                  <div style={{ textAlign: "center", width: "220px" }}>
                    <div style={{ borderTop: "2px solid #0f172a", marginBottom: "8px" }} />
                    <strong style={{ fontSize: "14px", color: "#0f172a" }}>Manager Sign</strong>
                  </div>
                </div>

                <div style={{ marginTop: "25px", display: "flex", justifyContent: "flex-end", gap: "10px", position: "relative", zIndex: 1 }} className="print-hide">
                  <button
                    className="primary-btn"
                    onClick={() =>
                      handlePrintReport(
                        `${activeReportPrintData ? activeReportPrintData.entityName : selectedRider?.name || "Rider"}_${activeReportPrintData ? activeReportPrintData.startDate : historyStart}_to_${activeReportPrintData ? activeReportPrintData.endDate : historyEnd}`
                      )
                    }
                    style={{ background: "#3b82f6" }}
                  >
                    🖨️ Print / Download PDF
                  </button>
                  {activeReportPrintData && (
                    <button className="primary-btn" onClick={() => setActiveReportPrintData(null)} style={{ background: "#64748b" }}>Close Archive View</button>
                  )}
                </div>
              </div>
            )}

            {historyType === "online" && (
              <>
                <div className="panel">
                  <div className="panel-head">
                    <div>
                      <h3>Date-wise summary</h3>
                      <p>Selected period totals</p>
                    </div>
                    <span className="count-pill">{historyRows.length} days</span>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>bKash</th>
                          <th>Nagad</th>
                          <th className="right">Rocket</th>
                        </tr>
                      </thead>
                      <tbody>
                        {historyRows.map((row) => (
                          <tr key={row.date}>
                            <td>{row.date}</td>
                            <td>{money(row.bkash)}</td>
                            <td>{money(row.nagad)}</td>
                            <td className="right">{money(row.rocket)}</td>
                          </tr>
                        ))}
                        {!historyRows.length && <EmptyRow colSpan={4} />}
                      </tbody>
                      {historyRows.length > 0 && (
                        <tfoot>
                          <tr>
                            <th>Grand total</th>
                            <th>{money(historyTotals.bkash)}</th>
                            <th>{money(historyTotals.nagad)}</th>
                            <th className="right">{money(historyTotals.rocket)}</th>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>
                <div className="panel">
                  <div className="panel-head">
                    <div>
                      <h3>Saved entries</h3>
                      <p>Ledger records for selected date range</p>
                    </div>
                  </div>
                  <EntryTable
                    entries={historySavedEntries}
                    onDelete={(id) =>
                      setDeleteModalData({
                        collectionName: COLLECTIONS.online,
                        id,
                        title: "Delete Online Entry",
                        message: "Are you sure you want to delete this online entry?",
                      })
                    }
                    showMethod={true}
                  />
                </div>
              </>
            )}
          </section>
        )}

        {/* 6. BULK RESTAURANT MANAGEMENT & DELIVERY CHARGE COMBINED */}
        {page === "bulk" && (
          <section key="page-bulk" className="content page-animate">
            <div className="section-heading">
              <div>
                <h2>Bulk Restaurant Management & Delivery Charge</h2>
                <p>
                  Multi-select restaurants to Turn On/Off and manage Delivery Charge. While turning ON, if a restaurant&apos;s delivery charge is ৳0, the entered delivery charge will automatically be added.
                </p>
              </div>
            </div>

            <div className="panel bulk-action-panel">
              <div className="panel-head" style={{ flexWrap: "wrap", gap: "12px" }}>
                <div>
                  <h3>Restaurant Controls & Delivery Charge</h3>
                  <p>Select restaurants below, set delivery charge (৳), and trigger Turn On, Turn Off, or Save Charge</p>
                </div>
                <div className="bulk-actions-btns">
                  <button
                    type="button"
                    className="primary-btn on-btn"
                    onClick={() => handleBulkRestaurantAction(true)}
                    disabled={saving}
                  >
                    {saving ? "Processing..." : "Turn On (Open, Priority 0, Locations & Auto-Add Charge if 0)"}
                  </button>
                  <button
                    type="button"
                    className="primary-btn off-btn"
                    onClick={() => handleBulkRestaurantAction(false)}
                    disabled={saving}
                  >
                    {saving ? "Processing..." : "Turn Off (Close, Priority 1000)"}
                  </button>
                </div>
              </div>

              <form
                onSubmit={handleBulkSaveDeliveryCharge}
                style={{
                  background: "#ffffff",
                  border: "1.5px solid #cbd5e1",
                  borderRadius: "12px",
                  padding: "16px",
                  marginBottom: "18px",
                  display: "flex",
                  alignItems: "flex-end",
                  gap: "12px",
                  flexWrap: "wrap",
                }}
              >
                <label style={{ display: "grid", gap: "6px", fontSize: "11px", fontWeight: "800", color: "#334155", minWidth: "220px", flex: "1 1 220px" }}>
                  Delivery Charge (৳) — (Auto-added on Turn On if current charge is 0)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={bulkDeliveryChargeInput}
                    onChange={(e) => setBulkDeliveryChargeInput(e.target.value)}
                    placeholder="0.00"
                    style={{
                      height: "42px",
                      border: "1.5px solid #10b981",
                      borderRadius: "8px",
                      padding: "0 12px",
                      fontSize: "15px",
                      fontWeight: "800",
                      color: "#0f172a",
                      outline: "none",
                    }}
                  />
                </label>

                <button
                  type="submit"
                  className="primary-btn"
                  disabled={saving || !selectedRestaurantIds.length}
                  style={{ height: "42px", background: "#2563eb" }}
                >
                  💾 Save Delivery Charge ({selectedRestaurantIds.length} selected)
                </button>

                <label style={{ display: "grid", gap: "6px", fontSize: "11px", fontWeight: "800", color: "#334155", minWidth: "200px", flex: "1 1 200px" }}>
                  Search Restaurant
                  <input
                    type="text"
                    value={bulkSearch}
                    onChange={(e) => setBulkSearch(e.target.value)}
                    placeholder="Filter restaurants..."
                    style={{
                      height: "42px",
                      border: "1px solid #cbd5e1",
                      borderRadius: "8px",
                      padding: "0 12px",
                      fontSize: "13px",
                      outline: "none",
                    }}
                  />
                </label>
              </form>

              <div className="selection-controls">
                <button type="button" className="text-btn" onClick={selectAllRestaurants}>Select All</button>
                <button type="button" className="text-btn" onClick={clearSelectedRestaurants}>Clear Selection</button>
                <span className="count-pill">{selectedRestaurantIds.length} restaurants selected</span>
              </div>

              <div className="multi-select-grid" style={{ maxHeight: "460px" }}>
                {restaurants
                  .filter((res) =>
                    !bulkSearch
                      ? true
                      : normalized(res.name || res.restaurantName || res.id).includes(normalized(bulkSearch))
                  )
                  .map((res) => {
                    const isSelected = selectedRestaurantIds.includes(res.id);
                    const currentCharge = Number(res.hiddenDeliveryCharge ?? 0);
                    return (
                      <div
                        key={res.id}
                        className={`restaurant-checkbox-card ${isSelected ? "selected" : ""}`}
                        onClick={() => toggleRestaurantSelection(res.id)}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "6px" }}>
                          <input type="checkbox" checked={isSelected} onChange={() => {}} />
                          <span
                            style={{
                              fontSize: "11px",
                              fontWeight: "800",
                              padding: "2px 8px",
                              borderRadius: "12px",
                              background: currentCharge > 0 ? "#dcfce7" : "#f1f5f9",
                              color: currentCharge > 0 ? "#15803d" : "#64748b",
                            }}
                          >
                            Charge: {money(currentCharge)}
                          </span>
                        </div>
                        <span>{res.name || res.restaurantName || res.id}</span>
                        <small className="cell-sub">
                          Status: <strong>{res.open || "N/A"}</strong> | Priority: {res.priority ?? "N/A"}
                        </small>
                      </div>
                    );
                  })}
              </div>
            </div>
          </section>
        )}

        {/* 7. PAPER WORK & REPORTS */}
        {page === "paperwork" && (
          <section key="page-paperwork" className="content page-animate">
            <div className="section-heading print-hide">
              <div>
                <h2>Paper Work & Profit Calculation</h2>
                <p>Select riders, filter by date, view calculated metrics, manage salaries, and save permanent date-wise reports.</p>
              </div>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                <button className="primary-btn" onClick={saveCurrentPaperWorkReport}>💾 Save Permanent Report for {paperWorkDate}</button>
                <button className="primary-btn" onClick={() => handlePrintReport(`Paper_Work_${paperWorkDate}`)} style={{ background: "#3b82f6" }}>Print / Download PDF View</button>
              </div>
            </div>

            <div className="panel print-hide">
              <div className="filter-bar">
                <label>
                  Paper Work Date
                  <input type="date" value={paperWorkDate} onChange={(e) => setPaperWorkDate(e.target.value)} />
                </label>
              </div>

              <div style={{ marginTop: "15px" }}>
                <div className="panel-head">
                  <h3>Select Riders ({paperWorkRiderIds.length} selected)</h3>
                  <div className="bulk-actions-btns">
                    <button type="button" className="text-btn" onClick={selectAllPaperWorkRiders}>Select All Riders</button>
                    <button type="button" className="text-btn" onClick={clearPaperWorkRiders}>Clear Riders</button>
                  </div>
                </div>
                <div className="multi-select-grid">
                  {ridersWithBill.map((r) => {
                    const isSelected = paperWorkRiderIds.includes(r.id);
                    return (
                      <div
                        key={r.id}
                        className={`restaurant-checkbox-card ${isSelected ? "selected" : ""}`}
                        onClick={() => togglePaperWorkRider(r.id)}
                      >
                        <input type="checkbox" checked={isSelected} onChange={() => {}} />
                        <span>{r.name || r.id}</span>
                        <small className="cell-sub" style={{ color: "#16a34a", fontWeight: "700" }}>
                          Bill ({paperWorkDate}): {money(r.calculatedBill)}
                        </small>
                        <small className="cell-sub">Phone: {r.phone || "N/A"}</small>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {firestorePaperReports.length > 0 && (
              <div className="panel print-hide">
                <div className="panel-head">
                  <div>
                    <h3>Saved Paper Work Reports Archive (Permanent Database Snapshot)</h3>
                    <p>Download CSV/PDF or view previously saved permanent reports</p>
                  </div>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Report Date</th>
                        <th>Saved At</th>
                        <th>Total Profit</th>
                        <th className="right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {firestorePaperReports.map((rep) => (
                        <tr key={rep.id}>
                          <td><strong>{rep.date}</strong></td>
                          <td>{formatDateTime(rep.savedAt)}</td>
                          <td>{money(rep.profit)}</td>
                          <td className="right" style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                            <button className="primary-btn" style={{ height: "30px", padding: "0 12px", fontSize: "11px", background: "#059669" }} onClick={() => setActivePaperworkPrintReport(rep)}>
                              👁️ View / Print PDF
                            </button>
                            <button className="primary-btn" style={{ height: "30px", padding: "0 12px", fontSize: "11px" }} onClick={() => downloadSavedReportCSV(rep)}>
                              📥 CSV
                            </button>
                            <button className="delete-btn" style={{ height: "30px", padding: "0 12px", fontSize: "11px" }} onClick={() => deleteSavedReport(rep.id)}>
                              🗑️ Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="printable-report-area history-print-box" style={{ background: "#fff", padding: "30px", borderRadius: "14px", border: "1px solid #e2e8f0", position: "relative" }}>
              <div className="pdf-watermark-logo" style={{ display: "none", position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", opacity: 0.05, pointerEvents: "none", zIndex: 0 }}>
                <FoodishLogo size={360} />
              </div>

              <div className="print-header" style={{ textAlign: "center", marginBottom: "30px", position: "relative", zIndex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", marginBottom: "4px" }}>
                  <FoodishLogo size={36} />
                  <span style={{ fontSize: "28px", fontWeight: "900", letterSpacing: "2px", color: "#10b981" }}>FOODISH</span>
                </div>
                <h1 style={{ fontSize: "32px", fontWeight: "900", color: "#0f172a", margin: "0 0 8px", textTransform: "uppercase" }}>
                  FOODISH STATEMENT {activePaperworkPrintReport ? `(${activePaperworkPrintReport.date})` : ""}
                </h1>
                <p style={{ fontSize: "16px", fontWeight: "700", color: "#475569", margin: 0 }}>
                  Date: {activePaperworkPrintReport ? activePaperworkPrintReport.date : paperWorkDate}
                </p>
              </div>

              <div className="panel" style={{ border: 0, padding: 0, boxShadow: "none", position: "relative", zIndex: 1, background: "rgba(255,255,255,0.96)" }}>
                <div className="panel-head print-hide">
                  <div>
                    <h3>Performance & Ledger Table {activePaperworkPrintReport ? `(Viewing Saved Report: ${activePaperworkPrintReport.date})` : ""}</h3>
                    <p>Date: {activePaperworkPrintReport ? activePaperworkPrintReport.date : paperWorkDate}</p>
                  </div>
                  {activePaperworkPrintReport && (
                    <div style={{ display: "flex", gap: "10px" }}>
                      <button className="print-hide primary-btn" style={{ height: "32px", padding: "0 12px", background: "#3b82f6", fontSize: "11px" }} onClick={() => handlePrintReport(`Paper_Work_${activePaperworkPrintReport.date}`)}>
                        🖨️ Print / Download PDF
                      </button>
                      <button className="print-hide primary-btn" style={{ height: "32px", padding: "0 12px", background: "#64748b", fontSize: "11px" }} onClick={() => setActivePaperworkPrintReport(null)}>
                        Close Saved View
                      </button>
                    </div>
                  )}
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Delivered</th>
                        <th>Online</th>
                        <th>Bill</th>
                        <th>Charge</th>
                        <th>Salary</th>
                        <th>Fine</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(activePaperworkPrintReport ? activePaperworkPrintReport.rows : paperWorkTableRows).map((row) => (
                        <tr key={row.riderId}>
                          <td><strong>{row.name}</strong></td>
                          <td>{row.delivered}</td>
                          <td>{money(row.online)}</td>
                          <td>{money(row.bill)}</td>
                          <td>{money(row.charge)}</td>
                          <td>
                            {activePaperworkPrintReport ? (
                              money(row.salary)
                            ) : (
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={row.salary}
                                onChange={(e) =>
                                  handleUpdateManagementEntry({
                                    entityType: "rider",
                                    entityId: row.riderId,
                                    entityName: row.name,
                                    type: "salary",
                                    amount: e.target.value,
                                    date: paperWorkDate,
                                  })
                                }
                                style={{ width: "90px", padding: "6px", borderRadius: "6px", border: "1px solid #cbd5e1", fontWeight: "700", fontSize: "13px" }}
                              />
                            )}
                          </td>
                          <td>{money(row.fine)}</td>
                        </tr>
                      ))}
                      {!activePaperworkPrintReport && paperWorkTableRows.length === 0 && (
                        <tr>
                          <td colSpan={7} className="empty-cell">Please select at least one rider to view paper work metrics.</td>
                        </tr>
                      )}
                    </tbody>
                    {(activePaperworkPrintReport ? activePaperworkPrintReport.rows : paperWorkTableRows).length > 0 && (
                      <tfoot>
                        <tr>
                          <th>All Total</th>
                          <th>{activePaperworkPrintReport ? activePaperworkPrintReport.totals.delivered : paperWorkTotals.delivered}</th>
                          <th>{money(activePaperworkPrintReport ? activePaperworkPrintReport.totals.online : paperWorkTotals.online)}</th>
                          <th>{money(activePaperworkPrintReport ? activePaperworkPrintReport.totals.bill : paperWorkTotals.bill)}</th>
                          <th>{money(activePaperworkPrintReport ? activePaperworkPrintReport.totals.charge : paperWorkTotals.charge)}</th>
                          <th>{money(activePaperworkPrintReport ? activePaperworkPrintReport.totals.salary : paperWorkTotals.salary)}</th>
                          <th>{money(activePaperworkPrintReport ? activePaperworkPrintReport.totals.fine : paperWorkTotals.fine)}</th>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>

              <div style={{ marginTop: "30px", padding: "25px", background: "linear-gradient(135deg, #f0fdf4 0%, #e6f6ef 100%)", border: "2px solid #bbf7d0", borderRadius: "12px", textAlign: "center", position: "relative", zIndex: 1 }}>
                <div style={{ fontSize: "14px", fontWeight: "800", color: "#15803d", letterSpacing: "1px" }}>PROFIT SUMMARY</div>
                <div style={{ fontSize: "40px", fontWeight: "900", color: "#14532d", margin: "6px 0 0" }}>
                  {money(activePaperworkPrintReport ? activePaperworkPrintReport.profit : calculatedProfit)}
                </div>
                <div style={{ fontSize: "12px", fontWeight: "700", color: "#334155", marginTop: "4px" }}>
                  Formula: (Total Bill × 9.41%) + Total Charge
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "80px", paddingTop: "20px", position: "relative", zIndex: 1 }}>
                <div style={{ textAlign: "center", width: "220px" }}>
                  <div style={{ borderTop: "2px solid #0f172a", marginBottom: "8px" }} />
                  <strong style={{ fontSize: "14px", color: "#0f172a" }}>Manager Sign</strong>
                </div>
                <div style={{ textAlign: "center", width: "220px" }}>
                  <div style={{ borderTop: "2px solid #0f172a", marginBottom: "8px" }} />
                  <strong style={{ fontSize: "14px", color: "#0f172a" }}>Director Sign</strong>
                </div>
              </div>

              <div style={{ marginTop: "25px", display: "flex", justifyContent: "flex-end", gap: "10px", position: "relative", zIndex: 1 }} className="print-hide">
                <button className="primary-btn" onClick={() => handlePrintReport(`Paper_Work_${paperWorkDate}`)} style={{ background: "#3b82f6" }}>🖨️ Print / Download PDF</button>
                {activePaperworkPrintReport && (
                  <button className="primary-btn" onClick={() => setActivePaperworkPrintReport(null)} style={{ background: "#64748b" }}>Close Saved View</button>
                )}
              </div>
            </div>
          </section>
        )}

        <footer className="footer print-hide">Foodish Accounts · Firebase Firestore · Built for internal operations</footer>
      </main>

      {/* FULL ORDER DETAILS MODAL */}
      {orderDetailModal && (
        <div
          className="modal-backdrop"
          onClick={() => setOrderDetailModal(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.65)",
            zIndex: 70,
            display: "grid",
            placeItems: "center",
            padding: "16px",
            backdropFilter: "blur(4px)",
          }}
        >
          <div
            className="modal-card-animate"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#ffffff",
              padding: "24px",
              borderRadius: "18px",
              width: "100%",
              maxWidth: "600px",
              maxHeight: "88vh",
              overflowY: "auto",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.35)",
              border: "2px solid #10b981",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                borderBottom: "1px solid #e2e8f0",
                paddingBottom: "14px",
                marginBottom: "16px",
                gap: "12px",
              }}
            >
              <div>
                <span style={{ fontSize: "11px", fontWeight: "800", color: "#059669", letterSpacing: "0.8px" }}>
                  FULL ORDER DETAILS
                </span>
                <h3 style={{ margin: "4px 0 0", fontSize: "20px", fontWeight: "900", color: "#0f172a" }}>
                  Order #{orderDetailModal.orderId}
                </h3>
                <div style={{ fontSize: "12px", color: "#64748b", marginTop: "3px", fontWeight: "700" }}>
                  Date: <strong>{orderDetailModal.date}</strong> · Time:{" "}
                  <strong>{orderDetailModal.createdAtFormatted || formatDateTime(orderDetailModal.createdAt)}</strong>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOrderDetailModal(null)}
                style={{
                  border: "1px solid #cbd5e1",
                  background: "#f8fafc",
                  color: "#334155",
                  borderRadius: "8px",
                  padding: "6px 12px",
                  fontSize: "13px",
                  fontWeight: "800",
                  cursor: "pointer",
                }}
              >
                ✕ Close
              </button>
            </div>

            {orderDetailModal.note && (
              <div
                style={{
                  padding: "12px 14px",
                  background: "#fef2f2",
                  border: "2px solid #ef4444",
                  borderRadius: "10px",
                  color: "#b91c1c",
                  fontWeight: "900",
                  fontSize: "14px",
                  marginBottom: "16px",
                }}
              >
                🚨 ORDER NOTE: {orderDetailModal.note}
              </div>
            )}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                gap: "10px",
                marginBottom: "16px",
              }}
            >
              <div style={{ background: "#f8fafc", padding: "10px 12px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: "10px", fontWeight: "800", color: "#64748b" }}>ORDER STATUS</div>
                <div style={{ marginTop: "4px" }}>
                  <span
                    className={`status ${
                      orderDetailModal.isDelivered ? "good" : orderDetailModal.isCancelled ? "bad" : "pending"
                    }`}
                  >
                    {orderDetailModal.status}
                  </span>
                </div>
              </div>
              <div style={{ background: "#f8fafc", padding: "10px 12px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: "10px", fontWeight: "800", color: "#64748b" }}>PAYMENT METHOD</div>
                <div style={{ fontSize: "14px", fontWeight: "800", color: "#0f172a", marginTop: "3px" }}>
                  {orderDetailModal.payment || "—"}
                </div>
              </div>
              <div style={{ background: "#ecfdf5", padding: "10px 12px", borderRadius: "10px", border: "1px solid #a7f3d0" }}>
                <div style={{ fontSize: "10px", fontWeight: "800", color: "#065f46" }}>ORDER TOTAL PRICE</div>
                <div style={{ fontSize: "16px", fontWeight: "900", color: "#047857", marginTop: "2px" }}>
                  {money(orderDetailModal.amount)}
                </div>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "12px",
                marginBottom: "16px",
              }}
            >
              <div style={{ background: "#eff6ff", padding: "12px 14px", borderRadius: "12px", border: "1px solid #bfdbfe" }}>
                <div style={{ fontSize: "11px", fontWeight: "800", color: "#1d4ed8", marginBottom: "4px" }}>
                  👤 CUSTOMER INFORMATION
                </div>
                <div style={{ fontSize: "14px", fontWeight: "800", color: "#0f172a" }}>
                  {orderDetailModal.userName || "—"}
                </div>
                <div style={{ fontSize: "12px", fontWeight: "700", color: "#334155", marginTop: "2px" }}>
                  Phone: {orderDetailModal.userPhone || "—"}
                </div>
                {orderDetailModal.userAddress && (
                  <div style={{ fontSize: "12px", color: "#475569", marginTop: "3px" }}>
                    Address: {orderDetailModal.userAddress}
                  </div>
                )}
              </div>

              <div style={{ background: "#f5f3ff", padding: "12px 14px", borderRadius: "12px", border: "1px solid #ddd6fe" }}>
                <div style={{ fontSize: "11px", fontWeight: "800", color: "#6d28d9", marginBottom: "4px" }}>
                  🛵 RIDER INFORMATION
                </div>
                <div style={{ fontSize: "14px", fontWeight: "800", color: "#0f172a" }}>
                  {orderDetailModal.riderName || "—"}
                </div>
                <div style={{ fontSize: "12px", fontWeight: "700", color: "#334155", marginTop: "2px" }}>
                  Phone: {orderDetailModal.riderPhone || "—"}
                </div>
              </div>
            </div>

            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "12px", fontWeight: "800", color: "#0f172a", marginBottom: "8px" }}>
                🍽️ MULTI-RESTAURANT PRODUCT & PRICE BREAKDOWN
              </div>
              {Array.isArray(orderDetailModal.items) && orderDetailModal.items.length > 0 ? (
                <OrderItemsBreakdown items={orderDetailModal.items} />
              ) : (
                <div style={{ padding: "14px", background: "#f8fafc", borderRadius: "10px", fontSize: "12px", color: "#64748b" }}>
                  No item details recorded for this order.
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="primary-btn"
                onClick={() => setOrderDetailModal(null)}
                style={{ background: "#0f172a", height: "40px", padding: "0 22px" }}
              >
                Close Details
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODALS */}
      {noteModalEntry && (
        <div className="modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.55)", zIndex: 50, display: "grid", placeItems: "center", padding: "16px", backdropFilter: "blur(3px)" }}>
          <div className="modal-card-animate" style={{ background: "#fff", padding: "24px", borderRadius: "16px", width: "100%", maxWidth: "400px", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.15)" }}>
            <h3 style={{ margin: "0 0 10px", fontSize: "16px", fontWeight: "800", color: "#0f172a" }}>
              Note for {noteModalEntry.entityName} ({noteModalEntry.date})
            </h3>
            <p style={{ fontSize: "12px", color: "#64748b", margin: "0 0 15px" }}>Type: {noteModalEntry.type.toUpperCase()} | Amount: {money(noteModalEntry.amount)}</p>
            <textarea
              value={noteInputVal}
              onChange={(e) => setNoteInputVal(e.target.value)}
              placeholder="Write a note here..."
              rows={4}
              style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "13px", outline: "none", marginBottom: "15px" }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button className="primary-btn" style={{ background: "#64748b" }} onClick={() => setNoteModalEntry(null)}>
                Cancel
              </button>
              <button
                className="primary-btn"
                onClick={async () => {
                  await handleUpdateManagementEntry({
                    entityType: noteModalEntry.entityType,
                    entityId: noteModalEntry.entityId,
                    entityName: noteModalEntry.entityName,
                    type: noteModalEntry.type,
                    amount: noteModalEntry.amount,
                    date: noteModalEntry.date,
                    note: noteInputVal,
                  });
                  setNoteModalEntry(null);
                }}
              >
                Save Note
              </button>
            </div>
          </div>
        </div>
      )}

      {editModalData && (
        <div className="modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.55)", zIndex: 60, display: "grid", placeItems: "center", padding: "16px", backdropFilter: "blur(3px)" }}>
          <div className="modal-card-animate" style={{ background: "#fff", padding: "28px", borderRadius: "20px", width: "100%", maxWidth: "420px", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)" }}>
            <h3 style={{ margin: "0 0 6px", fontSize: "18px", fontWeight: "800", color: "#0f172a" }}>{editModalData.title}</h3>
            <p style={{ fontSize: "13px", color: "#64748b", margin: "0 0 20px" }}>{editModalData.entityName} · Date: {editModalData.date}</p>

            <label style={{ display: "grid", gap: "6px", fontSize: "11px", fontWeight: "700", color: "#475569", marginBottom: "20px" }}>
              New Amount (৳)
              <input
                type="number"
                step="0.01"
                value={editAmountVal}
                onChange={(e) => setEditAmountVal(e.target.value)}
                style={{ height: "46px", border: "1px solid #cbd5e1", borderRadius: "10px", padding: "0 14px", fontSize: "16px", fontWeight: "700", color: "#0f172a", outline: "none" }}
                autoFocus
              />
            </label>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
              <button className="primary-btn" style={{ background: "#64748b", height: "42px", padding: "0 20px" }} onClick={() => setEditModalData(null)}>
                Cancel
              </button>
              <button
                className="primary-btn"
                style={{ background: "#10b981", height: "42px", padding: "0 20px" }}
                onClick={async () => {
                  if (editAmountVal === "" || Number.isNaN(Number(editAmountVal))) {
                    alert("Sothik amount din.");
                    return;
                  }
                  await handleUpdateManagementEntry({
                    entityType: editModalData.entityType,
                    entityId: editModalData.entityId,
                    entityName: editModalData.entityName,
                    type: editModalData.type,
                    amount: editAmountVal,
                    date: editModalData.date,
                  });

                  if (editModalData.entityType === "restaurant" && editModalData.type === "physical") {
                    await handleUpdateManagementEntry({
                      entityType: "restaurant",
                      entityId: editModalData.entityId,
                      entityName: editModalData.entityName,
                      type: "restaurant_checked",
                      amount: 1,
                      date: editModalData.date,
                    });
                  }

                  setEditModalData(null);
                }}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteModalData && (
        <div className="modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.55)", zIndex: 60, display: "grid", placeItems: "center", padding: "16px", backdropFilter: "blur(3px)" }}>
          <div className="modal-card-animate" style={{ background: "#fff", padding: "28px", borderRadius: "20px", width: "100%", maxWidth: "400px", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)", textAlign: "center" }}>
            <div style={{ width: "50px", height: "50px", borderRadius: "50%", background: "#fee2e2", color: "#dc2626", display: "grid", placeItems: "center", fontSize: "24px", margin: "0 auto 15px", fontWeight: "800" }}>!</div>
            <h3 style={{ margin: "0 0 8px", fontSize: "18px", fontWeight: "800", color: "#0f172a" }}>{deleteModalData.title}</h3>
            <p style={{ fontSize: "13px", color: "#64748b", margin: "0 0 24px" }}>{deleteModalData.message}</p>

            <div style={{ display: "flex", justifyContent: "center", gap: "12px" }}>
              <button className="primary-btn" style={{ background: "#64748b", height: "42px", padding: "0 20px" }} onClick={() => setDeleteModalData(null)}>
                Cancel
              </button>
              <button
                className="primary-btn"
                style={{ background: "#dc2626", height: "42px", padding: "0 20px" }}
                onClick={async () => {
                  deleteModalData.onConfirm();
                  setDeleteModalData(null);
                }}
              >
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {notice && <div className={`toast ${notice.type}`}><span>{notice.type === "success" ? "✓" : "!"}</span>{notice.text}</div>}
      {saving && <div className="saving-overlay"><div className="loader" /><strong>Saving your entry…</strong></div>}
    </div>
  );
}

function StatCard({ label, value, hint, icon, tone }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${tone}`}>{icon}</div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-hint">{hint}</div>
    </div>
  );
}

function EmptyRow({ colSpan = 6 }) {
  return <tr><td colSpan={colSpan} className="empty-cell">No records found for this selection.</td></tr>;
}

function EntryTable({ entries, onDelete, showMethod = false }) {
  const sorted = [...entries].sort((a, b) => (asDate(b.createdAt)?.getTime() || 0) - (asDate(a.createdAt)?.getTime() || 0));
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date / Time</th>
            {showMethod && <th>Method</th>}
            <th>Account / Type</th>
            <th>Note</th>
            <th className="right">Amount</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sorted.map((entry) => (
            <tr key={entry.id}>
              <td>{formatDateTime(entry.createdAt || entry.date)}</td>
              {showMethod && <td>{entry.method || "—"}</td>}
              <td>{entry.entityName || entry.type || "—"}</td>
              <td className="note-cell">{entry.note || "—"}</td>
              <td className="right">{money(entry.amount)}</td>
              <td>
                {!entry.readOnly && (
                  <button type="button" className="delete-btn" title="Delete entry" onClick={() => onDelete(entry.id)}>
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
          {!sorted.length && <EmptyRow colSpan={showMethod ? 6 : 5} />}
        </tbody>
      </table>
    </div>
  );
}

const styles = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap');
:root{font-family:'DM Sans',sans-serif;color:#172033;background:#f4f7fb;font-synthesis:none}
*{box-sizing:border-box}
html,body{margin:0;padding:0;width:100%;max-width:100vw;overflow-x:hidden;scroll-behavior:smooth}

/* KEYFRAME ANIMATIONS */
@keyframes pageFadeSlide {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes cardRise {
  from { opacity: 0; transform: translateY(16px) scale(0.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes modalBackdropFade {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes modalPop {
  from { opacity: 0; transform: scale(0.93) translateY(12px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
@keyframes pulseRing {
  0% { box-shadow: 0 0 0 0 rgba(32, 184, 121, 0.55); }
  70% { box-shadow: 0 0 0 7px rgba(32, 184, 121, 0); }
  100% { box-shadow: 0 0 0 0 rgba(32, 184, 121, 0); }
}
@keyframes floatSlow {
  0%, 100% { transform: translateY(0px) scale(1); }
  50% { transform: translateY(-18px) scale(1.04); }
}
@keyframes load {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(300%); }
}
@keyframes pop {
  from { transform: translateY(14px) scale(0.96); opacity: 0; }
  to { transform: translateY(0) scale(1); opacity: 1; }
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
@keyframes runnerMove {
  0% { left: -36px; transform: scaleX(-1) translateY(0px); }
  25% { transform: scaleX(-1) translateY(-3px); }
  50% { transform: scaleX(-1) translateY(0px); }
  75% { transform: scaleX(-1) translateY(-3px); }
  100% { left: calc(100% + 10px); transform: scaleX(-1) translateY(0px); }
}
@keyframes logoBounce {
  0%, 100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-10px) scale(1.06); }
}

.page-animate {
  animation: pageFadeSlide 0.36s cubic-bezier(0.22, 1, 0.36, 1) both;
}
.tab-pane-animate {
  animation: pageFadeSlide 0.3s cubic-bezier(0.22, 1, 0.36, 1) both;
}
.modal-backdrop {
  animation: modalBackdropFade 0.2s ease-out both;
}
.modal-card-animate {
  animation: modalPop 0.28s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.app-shell{min-height:100vh;width:100%;max-width:100vw;overflow-x:hidden;display:flex;background:linear-gradient(180deg,#f4f7fb 0%,#eef2f7 100%)}

/* APP LAUNCH RUNNING SPLASH SCREEN */
.boot-screen.running-splash {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: radial-gradient(circle at 50% 40%, #ecfdf5 0%, #f4f7fb 55%, #e2e8f0 100%);
  position: relative;
  overflow: hidden;
  padding: 24px;
}
.splash-glow-circle {
  position: absolute;
  width: 320px;
  height: 320px;
  border-radius: 50%;
  background: rgba(16, 185, 129, 0.14);
  filter: blur(30px);
  animation: floatSlow 4s ease-in-out infinite;
}
.splash-logo-wrap {
  animation: logoBounce 1.3s ease-in-out infinite;
  filter: drop-shadow(0 12px 24px rgba(220, 38, 38, 0.25));
  z-index: 1;
}
.splash-brand-title {
  font: 900 28px 'Plus Jakarta Sans', sans-serif;
  color: #0f172a;
  letter-spacing: -0.6px;
  z-index: 1;
}
.splash-brand-title span {
  color: #10b981;
}
.splash-runner-track {
  width: min(300px, 82vw);
  height: 34px;
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: flex-end;
  z-index: 1;
}
.splash-runner-scooter {
  position: absolute;
  bottom: 6px;
  font-size: 24px;
  animation: runnerMove 1.65s linear infinite;
}
.splash-runner-bar {
  width: 100%;
  height: 5px;
  background: #d1fae5;
  border-radius: 99px;
  overflow: hidden;
  position: relative;
}
.splash-runner-bar::after {
  content: "";
  position: absolute;
  inset: 0;
  width: 45%;
  background: linear-gradient(90deg, #10b981, #059669);
  border-radius: 99px;
  animation: load 1.2s ease-in-out infinite;
}
.splash-sync-text {
  margin: 0;
  font-size: 12.5px;
  font-weight: 700;
  color: #065f46;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.85);
  padding: 6px 14px;
  border-radius: 20px;
  border: 1px solid #a7f3d0;
  z-index: 1;
}
.sync-pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #10b981;
  animation: pulseRing 1.4s infinite;
}

/* SIDEBAR */
.sidebar{width:250px;background:linear-gradient(180deg,#0f172a 0%,#152238 100%);color:#d5deed;min-height:100vh;padding:27px 17px;display:flex;flex-direction:column;position:fixed;inset:0 auto 0 0;z-index:5;box-shadow:4px 0 24px rgba(15,23,42,0.12)}
.brand{display:flex;align-items:center;gap:11px;padding:0 10px 34px;transition:transform 0.2s ease}
.brand:hover{transform:translateX(2px)}
.brand-mark{width:40px;height:40px;border-radius:13px;background:linear-gradient(145deg,#34d399,#059669);display:grid;place-items:center;color:white;font-weight:800;font-size:22px;box-shadow:0 6px 16px rgba(16,185,129,0.32);transition:transform 0.25s cubic-bezier(0.34,1.56,0.64,1)}
.brand:hover .brand-mark{transform:rotate(-6deg) scale(1.06)}
.brand strong{display:block;color:#fff;font:800 18px 'Plus Jakarta Sans';letter-spacing:-0.3px}
.brand small{display:block;color:#8190a8;font-size:9px;letter-spacing:1.4px;margin-top:3px}
.side-label,.eyebrow{font-size:10px;font-weight:700;letter-spacing:1.5px;color:#8290a8}
.side-label{padding:0 12px 12px}
.sidebar nav{display:grid;gap:5px}
.nav-link{border:0;background:transparent;color:#9fb0c7;text-align:left;padding:12px 13px;border-radius:11px;display:flex;align-items:center;gap:12px;font:600 13px 'DM Sans';cursor:pointer;transition:all 0.2s cubic-bezier(0.22,1,0.36,1);position:relative}
.nav-link:hover{background:rgba(255,255,255,0.07);color:#fff;transform:translateX(4px)}
.nav-link.active{background:linear-gradient(90deg,rgba(16,185,129,0.22) 0%,rgba(16,185,129,0.08) 100%);color:#6ee7b7;box-shadow:inset 3px 0 0 #34d399}
.nav-icon{width:22px;text-align:center;font-size:17px;transition:transform 0.2s ease}
.nav-link:hover .nav-icon{transform:scale(1.14)}
.sidebar-bottom{margin-top:auto;border-top:1px solid rgba(255,255,255,0.08);padding:18px 10px 0;font-size:11px;color:#aab6c9}
.sidebar-bottom small{display:block;color:#74839b;margin:7px 0 8px 15px;font-size:10px}
.online-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#34d399;margin-right:7px;animation:pulseRing 2s infinite}

/* MAIN AREA & GLASS TOPBAR */
.main-area{margin-left:250px;width:calc(100% - 250px);max-width:100%;min-width:0;overflow-x:hidden}
.topbar{height:84px;background:rgba(255,255,255,0.88);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;padding:0 36px;position:sticky;top:0;z-index:4;width:100%}
.topbar h1{font:800 21px 'Plus Jakarta Sans';margin:4px 0 0;color:#0f172a;letter-spacing:-0.4px}
.eyebrow{color:#93a0b3;font-size:9px}
.topbar-right{display:flex;align-items:center;gap:12px}
.refresh-btn{background:#f1f5f9;color:#1e293b;padding:0 15px;height:36px;font-size:12px;border-radius:18px;border:1px solid #e2e8f0;transition:all 0.2s ease}
.refresh-btn:hover{background:#e2e8f0;transform:translateY(-1px)}
.today-chip{font-size:11px;font-weight:700;color:#065f46;background:#ecfdf5;border:1px solid #a7f3d0;padding:7px 13px;border-radius:20px;display:inline-flex;align-items:center;gap:6px}
.today-chip span{color:#10b981;display:inline-block;width:7px;height:7px;border-radius:50%;background:#10b981;font-size:0;animation:pulseRing 2s infinite}
.avatar{width:36px;height:36px;background:linear-gradient(135deg,#d1fae5,#a7f3d0);color:#065f46;border:1.5px solid #6ee7b7;border-radius:50%;display:grid;place-items:center;font-weight:800;box-shadow:0 2px 8px rgba(16,185,129,0.18);transition:transform 0.2s ease}
.avatar:hover{transform:scale(1.08)}

.content{max-width:1440px;width:100%;margin:0 auto;padding:28px 36px 22px}
.section-heading{display:flex;justify-content:space-between;align-items:end;margin:0 0 22px}
.section-heading h2{font:800 21px 'Plus Jakarta Sans';margin:0 0 5px;color:#0f172a;letter-spacing:-0.3px}
.section-heading p,.panel-head p{font-size:12px;color:#64748b;margin:0}
.date-label{font-size:11px;font-weight:600;color:#64748b;background:#fff;padding:6px 12px;border-radius:20px;border:1px solid #e2e8f0}

/* STAT CARDS */
.stats-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin-bottom:20px}
.stats-grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}
.stat-card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:19px;min-width:0;box-shadow:0 2px 10px rgba(15,23,42,0.03);transition:transform 0.25s cubic-bezier(0.22,1,0.36,1),box-shadow 0.25s ease,border-color 0.25s ease;animation:cardRise 0.42s cubic-bezier(0.22,1,0.36,1) both}
.stat-card:nth-child(1){animation-delay:0.03s}
.stat-card:nth-child(2){animation-delay:0.08s}
.stat-card:nth-child(3){animation-delay:0.13s}
.stat-card:nth-child(4){animation-delay:0.18s}
.stat-card:hover{transform:translateY(-4px);box-shadow:0 14px 28px -8px rgba(15,23,42,0.1);border-color:#cbd5e1}
.stat-icon{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;font-weight:800;font-size:16px;margin-bottom:13px;transition:transform 0.25s ease}
.stat-card:hover .stat-icon{transform:scale(1.1) rotate(-4deg)}
.stat-icon.green{background:#e7f8f0;color:#059669}
.stat-icon.red{background:#fff0ef;color:#dc2626}
.stat-icon.blue{background:#eaf2ff;color:#2563eb}
.stat-icon.purple{background:#f2edff;color:#7c3aed}
.stat-icon.pink{background:#fff0f6;color:#db2777}
.stat-icon.orange{background:#fff3e8;color:#ea580c}
.stat-label{font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.4px}
.stat-value{font:800 24px 'Plus Jakarta Sans';color:#0f172a;margin:5px 0;letter-spacing:-0.4px}
.stat-hint{font-size:11px;color:#94a3b8}

/* PANELS & FORMS */
.panel{background:#fff;border:1px solid #e2e8f0;border-radius:16px;margin-bottom:19px;padding:20px;box-shadow:0 3px 12px rgba(15,23,42,0.03);min-width:0;width:100%;transition:box-shadow 0.25s ease,border-color 0.25s ease}
.panel:hover{box-shadow:0 8px 24px rgba(15,23,42,0.05)}
.panel-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:17px;gap:10px}
.panel-head h3{font:800 15px 'Plus Jakarta Sans';margin:0 0 4px;color:#0f172a}
.count-pill{font-size:11px;font-weight:700;background:#f1f5f9;color:#475569;padding:6px 11px;border-radius:20px;white-space:nowrap}
.filter-bar{display:flex;align-items:end;gap:14px;flex-wrap:wrap;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:16px;margin-bottom:18px;width:100%;box-shadow:0 2px 8px rgba(15,23,42,0.02)}
.filter-bar label,.entry-form label{display:grid;gap:7px;color:#475569;font-size:11px;font-weight:700;min-width:160px}
.filter-bar select,.filter-bar input,.entry-form input,.entry-form select{height:40px;border:1.5px solid #e2e8f0;border-radius:9px;background:#fff;padding:0 11px;color:#0f172a;font:600 12.5px 'DM Sans';outline:none;width:100%;min-width:0;transition:border-color 0.2s ease,box-shadow 0.2s ease}
.filter-bar select:focus,.filter-bar input:focus,.entry-form input:focus,.entry-form select:focus{border-color:#10b981;box-shadow:0 0 0 3.5px rgba(16,185,129,0.15)}

/* TABLES */
.table-wrap{width:100%;overflow-x:auto}
table{width:100%;border-collapse:collapse;white-space:nowrap;text-align:left}
th{font-size:12px;text-transform:uppercase;letter-spacing:.7px;color:#334155;background:#f8fafc;padding:13px 12px;font-weight:800;border-bottom:1.5px solid #e2e8f0}
td{font-size:13.5px;color:#1e293b;padding:13px 12px;border-bottom:1px solid #f1f5f9;font-weight:600;transition:background-color 0.15s ease}
tbody tr:hover td{background-color:#f8fafc}
tbody tr:last-child td{border-bottom:0}
td strong{color:#0f172a;font-size:14px;font-weight:800}
.right{text-align:right}
.cell-sub{display:block;font-size:11px;color:#64748b;margin-top:3px;font-weight:600}
.status{display:inline-flex;align-items:center;padding:4px 10px;border-radius:20px;font-size:10px;font-weight:800;text-transform:capitalize;letter-spacing:0.2px}
.status.good{background:#dcfce7;color:#15803d}
.status.bad{background:#fee2e2;color:#b91c1c}
.status.pending{background:#fef3c7;color:#b45309}
.empty-cell{text-align:center;color:#94a3b8;padding:30px}

/* BUTTONS */
.entry-form{display:flex;align-items:end;gap:12px;flex-wrap:wrap;margin:2px 0 18px}
.entry-form label{flex:1}
.entry-form .note-field{flex:2;min-width:190px}
.rider-entry-form label{min-width:145px}
.primary-btn{height:42px;padding:0 20px;background:linear-gradient(135deg,#10b981 0%,#059669 100%);border:0;border-radius:10px;color:#fff;font:800 13px 'DM Sans';cursor:pointer;white-space:nowrap;box-shadow:0 4px 12px rgba(16,185,129,0.22);transition:transform 0.18s cubic-bezier(0.22,1,0.36,1),box-shadow 0.2s ease,filter 0.2s ease}
.primary-btn:hover{transform:translateY(-1.5px);box-shadow:0 8px 18px rgba(16,185,129,0.32);filter:brightness(1.04)}
.primary-btn:active{transform:translateY(0) scale(0.97)}
.primary-btn:disabled{opacity:.6;cursor:wait;transform:none}
.delete-btn{border:0;background:#fee2e2;color:#dc2626;border-radius:8px;padding:8px 12px;font-size:11px;font-weight:800;cursor:pointer;transition:all 0.18s ease}
.delete-btn:hover{background:#fecaca;transform:translateY(-1px)}
.delete-btn:active{transform:scale(0.96)}

/* TABS */
.tabs{display:flex;gap:6px;border-bottom:1px solid #e2e8f0;margin:-2px 0 15px}
.tabs button{background:none;border:0;padding:11px 18px;color:#64748b;font:700 12.5px 'DM Sans';cursor:pointer;border-bottom:2.5px solid transparent;transition:all 0.2s ease;border-radius:8px 8px 0 0}
.tabs button:hover{color:#0f172a;background:#f8fafc}
.tabs button.selected{color:#059669;border-color:#10b981;background:#f0fdf4}
.compact{border:0;padding:0;margin:0 0 15px}
.list-heading{margin-top:20px}
.footer{text-align:center;color:#94a3b8;font-size:11px;padding:16px 20px 26px}
.loading-line{height:3px;background:#e7f5ee;color:#059669;font-size:10px;padding-left:36px;overflow:hidden}
.loading-line span{display:block;height:3px;width:35%;background:linear-gradient(90deg,#10b981,#34d399);animation:load 1.4s infinite ease-in-out}
.alert{margin:18px 36px 0;padding:12px 14px;border-radius:10px;font-size:12px}
.error-alert{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca}
.toast{position:fixed;right:24px;bottom:24px;z-index:80;background:#0f172a;color:white;border-radius:12px;padding:14px 18px;box-shadow:0 16px 38px rgba(15,23,42,0.28);font-size:12.5px;font-weight:600;display:flex;gap:10px;align-items:center;max-width:min(440px,calc(100vw - 32px));animation:pop 0.26s cubic-bezier(0.16,1,0.3,1)}
.toast.success span{color:#34d399;font-weight:900}
.toast.error span{color:#f87171;font-weight:900}
.saving-overlay{position:fixed;inset:0;background:rgba(15,23,42,0.55);backdrop-filter:blur(3px);z-index:90;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;gap:12px;font-size:13px;font-weight:700;animation:modalBackdropFade 0.18s ease}
.loader{width:34px;height:34px;border:3.5px solid rgba(255,255,255,0.25);border-top-color:#34d399;border-radius:50%;animation:spin 0.7s linear infinite}
.boot-screen{min-height:100vh;display:grid;place-content:center;justify-items:center;gap:12px;background:#f4f7fb;color:#64748b;font:13px 'DM Sans'}

/* LOGIN SCREEN */
.login-page{min-height:100vh;position:relative;isolation:isolate;overflow:hidden;display:grid;place-items:center;padding:32px 18px;background:radial-gradient(ellipse at 15% 10%,#d1fae5 0,transparent 36%),radial-gradient(ellipse at 90% 90%,#dbeafe 0,transparent 38%),linear-gradient(135deg,#f8fbff 0%,#f1f6f8 48%,#f8faff 100%);font-family:'DM Sans',sans-serif;color:#17243b}
.login-glow{position:absolute;z-index:-1;border-radius:50%;filter:blur(6px);pointer-events:none;animation:floatSlow 7s ease-in-out infinite}
.login-glow-one{width:340px;height:340px;left:-130px;top:18%;background:#a7f3d0;opacity:.36}
.login-glow-two{width:400px;height:400px;right:-150px;bottom:4%;background:#bfdbfe;opacity:.36;animation-delay:3.5s}
.login-card{width:min(100%,460px);padding:48px 44px 36px;border:1px solid #e2e8f0;border-radius:26px;background:rgba(255,255,255,.94);box-shadow:0 24px 70px rgba(15,23,42,.12),0 3px 10px rgba(15,23,42,.04);text-align:center;backdrop-filter:blur(14px);animation:modalPop 0.45s cubic-bezier(0.16,1,0.3,1) both}
.login-brand-mark{width:60px;height:60px;margin:0 auto 15px;border-radius:19px;display:grid;place-items:center;background:linear-gradient(145deg,#34d399,#059669);box-shadow:0 10px 24px rgba(16,185,129,.28);color:#fff;font:800 30px 'Plus Jakarta Sans'}
.login-brand-name{font:800 25px 'Plus Jakarta Sans';letter-spacing:-.8px;color:#0f172a}.login-brand-name span{color:#10b981}
.login-kicker{margin-top:7px;color:#94a3b8;font-size:9px;font-weight:800;letter-spacing:1.7px}
.login-divider{height:1px;background:#e2e8f0;margin:28px 0 25px}
.login-card h1{margin:0;color:#0f172a;font:800 27px 'Plus Jakarta Sans';letter-spacing:-.8px}
.login-description{margin:10px 0 25px;color:#64748b;font-size:13px;line-height:1.8}
.google-login-button{width:100%;height:52px;display:flex;align-items:center;justify-content:center;gap:13px;border:1.5px solid #cbd5e1;border-radius:12px;background:#fff;color:#1e293b;font:700 13.5px 'DM Sans';cursor:pointer;box-shadow:0 3px 8px rgba(15,23,42,.04);transition:transform .2s ease,box-shadow .2s ease,border-color .2s ease}
.google-login-button:hover{transform:translateY(-2px);border-color:#94a3b8;box-shadow:0 10px 22px rgba(15,23,42,.09)}
.google-g{font:800 19px Arial,sans-serif;background:conic-gradient(from -45deg,#4285f4 0 25%,#34a853 25% 50%,#fbbc05 50% 75%,#ea4335 75%);background-clip:text;-webkit-background-clip:text;color:transparent}
.google-arrow{margin-left:auto;color:#64748b;font-size:17px;font-weight:500}
.login-error{display:grid;gap:5px;text-align:left;margin:0 0 17px;padding:12px 14px;border:1px solid #fecaca;border-radius:10px;background:#fef2f2;color:#b91c1c;font-size:11px;line-height:1.6;overflow-wrap:anywhere}
.login-error strong{font-size:12px}
.login-security{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:22px;color:#94a3b8;font-size:10.5px}
.security-dot{width:7px;height:7px;border-radius:50%;background:#10b981;animation:pulseRing 2s infinite}
.login-footer{position:absolute;bottom:18px;left:12px;right:12px;text-align:center;color:#94a3b8;font-size:10px}

/* BULK & CHECKBOX CARDS */
.bulk-action-panel { background: #fafbfc; border: 1px solid #e2e8f0; }
.bulk-actions-btns { display: flex; gap: 10px; flex-wrap: wrap; }
.on-btn { background: linear-gradient(135deg,#10b981 0%,#059669 100%); }
.off-btn { background: linear-gradient(135deg,#ef4444 0%,#dc2626 100%); box-shadow: 0 4px 12px rgba(239,68,68,0.22); }
.off-btn:hover { box-shadow: 0 8px 18px rgba(239,68,68,0.32); }
.selection-controls { display: flex; align-items: center; gap: 12px; margin-bottom: 15px; }
.text-btn { background: none; border: 0; color: #059669; font-weight: 800; font-size: 12px; cursor: pointer; padding: 0; }
.text-btn:hover { text-decoration: underline; }
.multi-select-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px; max-height: 250px; overflow-y: auto; padding: 8px; border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; }
.restaurant-checkbox-card { display: flex; flex-direction: column; gap: 4px; padding: 11px; border: 1.5px solid #e2e8f0; border-radius: 10px; cursor: pointer; background: #ffffff; transition: transform 0.18s ease, border-color 0.18s ease, background-color 0.18s ease, box-shadow 0.18s ease; }
.restaurant-checkbox-card:hover { border-color: #94a3b8; background: #f8fafc; transform: translateY(-2px); box-shadow: 0 6px 14px rgba(15,23,42,0.05); }
.restaurant-checkbox-card.selected { border-color: #10b981; background: #f0fdf4; box-shadow: 0 0 0 1px #10b981; }
.restaurant-checkbox-card span { font-weight: 800; font-size: 14px; color: #0f172a; }

/* HOLDABLE NOTE ROW */
.holdable-note-row { cursor: pointer; user-select: none; transition: background-color 0.15s ease, transform 0.12s ease; }
.holdable-note-row:hover { background-color: #fef2f2 !important; }
.holdable-note-row:active { background-color: #fee2e2 !important; transform: scale(0.996); }

/* UNIVERSAL ORDER CARDS */
.universal-card-list table, .universal-card-list thead, .universal-card-list tbody, .universal-card-list th, .universal-card-list td, .universal-card-list tr {
  display: block;
  width: 100%;
}
.universal-card-list thead tr {
  position: absolute;
  top: -9999px;
  left: -9999px;
}
.universal-card-list tr {
  background: #ffffff;
  border: 2px solid var(--card-border-color, #3b82f6);
  border-radius: 15px;
  margin-bottom: 16px;
  padding: 16px;
  box-shadow: 0 4px 14px rgba(15,23,42,0.04);
  transition: transform 0.22s cubic-bezier(0.22,1,0.36,1), box-shadow 0.22s ease;
  animation: cardRise 0.35s cubic-bezier(0.22,1,0.36,1) both;
}
.universal-card-list tr:hover {
  transform: translateY(-3px);
  box-shadow: 0 12px 24px -6px rgba(15,23,42,0.1);
}
.universal-card-list td {
  border: none;
  position: relative;
  padding: 8px 0;
  text-align: left;
  font-size: 14px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  border-bottom: 1px solid #f1f5f9;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.universal-card-list td:last-child {
  border-bottom: none;
}
.universal-card-list td::before {
  content: attr(data-label);
  font-weight: 800;
  text-transform: uppercase;
  color: #64748b;
  font-size: 11px;
  margin-bottom: 3px;
  letter-spacing: 0.5px;
}
.universal-card-list td.right {
  text-align: left;
}
.card-value-block {
  width: 100%;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.orders-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 15px;
}

/* Check-In Mobile-First Full-Width View Styles */
.checkin-mobile-page {
  width: 100%;
  max-width: 100%;
  overflow-x: hidden;
}
.checkin-filter-bar {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
  width: 100%;
}
.checkin-filter-bar label {
  min-width: 0;
  width: 100%;
}
.checkin-stats-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  width: 100%;
}
.checkin-columns-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
  width: 100%;
}
.checkin-panel {
  width: 100%;
  min-width: 0;
  overflow: hidden;
}
.checkin-card-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}
.checkin-item-card {
  width: 100%;
  background: #ffffff;
  border: 1.5px solid #e2e8f0;
  border-radius: 13px;
  padding: 13px 15px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease, background-color 0.18s ease;
}
.checkin-item-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 18px rgba(15,23,42,0.06);
}
.checkin-item-card.is-checked {
  background: #f0fdf4;
  border-color: #16a34a;
}
.checkin-card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
}
.checkin-title-wrap {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  min-width: 0;
  flex: 1;
}
.checkin-rank {
  background: #f1f5f9;
  color: #334155;
  font-size: 11px;
  font-weight: 800;
  padding: 4px 7px;
  border-radius: 7px;
  flex-shrink: 0;
}
.checkin-item-card.is-checked .checkin-rank {
  background: #dcfce7;
  color: #15803d;
}
.checkin-name-group {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.checkin-entity-name {
  font-size: 14px;
  font-weight: 800;
  color: #0f172a;
  line-height: 1.35;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.checkin-sub-info {
  font-size: 11px;
  color: #64748b;
  font-weight: 600;
  margin-top: 2px;
  overflow-wrap: anywhere;
}
.checkin-toggle-btn {
  flex-shrink: 0;
  border-radius: 9px;
  padding: 7px 12px;
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  transition: transform 0.15s ease, background-color 0.15s ease;
}
.checkin-toggle-btn:active {
  transform: scale(0.95);
}
.checkin-toggle-btn.checked {
  border: 2px solid #16a34a;
  background: #16a34a;
  color: #ffffff;
}
.checkin-toggle-btn.unchecked {
  border: 2px solid #cbd5e1;
  background: #ffffff;
  color: #475569;
}
.checkin-card-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 8px;
  border-top: 1px dashed #e2e8f0;
  gap: 8px;
  width: 100%;
}
.checkin-item-card.is-checked .checkin-card-bottom {
  border-top-color: #bbf7d0;
}
.checkin-metric-label {
  font-size: 11px;
  font-weight: 700;
  color: #64748b;
}
.checkin-metric-value {
  font-size: 15px;
  font-weight: 900;
  color: #0f172a;
}

@media (max-width: 900px) {
  .checkin-columns-grid {
    grid-template-columns: 1fr;
  }
  .checkin-stats-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 480px) {
  .checkin-filter-bar {
    grid-template-columns: 1fr;
  }
  .checkin-panel {
    padding: 12px;
  }
  .checkin-item-card {
    padding: 11px 12px;
  }
}

@media print {
  @page {
    size: A4 portrait;
    margin: 5mm;
  }
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
  }
  body {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .print-hide, .sidebar, .topbar, .footer {
    display: none !important;
  }
  .app-shell, .main-area {
    margin: 0 !important;
    width: 100% !important;
    background: #fff !important;
  }
  .content {
    padding: 0 !important;
    max-width: 100% !important;
  }
  .panel {
    border: none !important;
    box-shadow: none !important;
    padding: 0 !important;
    margin-bottom: 10px !important;
    background: transparent !important;
  }
  .printable-report-area, .history-print-box {
    width: 100% !important;
    max-width: 100% !important;
    padding: 5px !important;
    margin: 0 !important;
    border: none !important;
    position: relative !important;
    background: #fff !important;
  }
  .pdf-watermark-logo {
    display: block !important;
  }
  table {
    width: 100% !important;
    table-layout: auto !important;
    border-collapse: collapse !important;
    overflow: visible !important;
    font-size: 10px !important;
  }
  table th, table td {
    font-size: 10px !important;
    padding: 4px 6px !important;
    white-space: nowrap !important;
  }
  .printable-report-area table td:nth-child(4) {
    white-space: normal !important;
  }
  tr {
    page-break-inside: avoid !important;
  }
}
@media(max-width:520px){.login-page{padding:22px 14px 58px}.login-card{padding:37px 24px 29px;border-radius:20px}.login-card h1{font-size:24px}.login-brand-name{font-size:23px}.login-description{font-size:12px}}
@media(max-width:1000px){.sidebar{width:210px}.main-area{margin-left:210px;width:calc(100% - 210px)}.content{padding:24px}.topbar{padding:0 24px}.stats-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:680px){.sidebar{width:270px;max-width:82vw;padding:22px 17px;transform:translateX(-105%);transition:transform .32s cubic-bezier(.2,.8,.2,1);box-shadow:18px 0 50px #101b2e24}.sidebar.sidebar-open{transform:translateX(0)}.brand{padding:0 8px 30px}.brand>div:last-child,.side-label,.nav-link span:last-child,.sidebar-bottom{display:block}.nav-link{justify-content:flex-start;padding:14px 12px;min-height:46px}.main-area{margin-left:0;width:100%}.topbar{height:72px;padding:0 14px 0 58px;position:sticky}.mobile-menu-btn{display:grid;place-items:center;position:absolute;left:13px;top:18px;width:34px;height:34px;border:1px solid #e7edf2;border-radius:9px;background:#fff;color:#26364b;font-size:18px;cursor:pointer}.sidebar-scrim{display:block;position:fixed;inset:0;background:#0d1728a6;border:0;z-index:4;backdrop-filter:blur(2px);animation:modalBackdropFade 0.2s ease}.topbar h1{font-size:18px}.content{padding:16px 12px 30px}.section-heading{align-items:start;gap:10px;flex-direction:column}.section-heading h2{font-size:19px}.stats-grid,.stats-grid.two{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.stat-card{padding:14px;min-height:120px;border-radius:14px}.stat-icon{width:34px;height:34px}.stat-value{font-size:clamp(17px,4.8vw,22px)}.stat-label{font-size:11px}.stat-hint{font-size:10px;line-height:1.4}.panel{padding:14px;border-radius:14px}.filter-bar{padding:12px;gap:10px}.filter-bar label{flex:1 1 100%;min-width:0;font-size:11px}.filter-bar select,.filter-bar input,.entry-form input,.entry-form select{height:42px;font-size:14px}.entry-form{display:grid;grid-template-columns:1fr;gap:13px}.entry-form label,.entry-form .note-field{min-width:0}.entry-form label{font-size:11px}.entry-form .primary-btn{width:100%;height:46px;font-size:13px}.primary-btn,.delete-btn{min-height:40px}.table-wrap{border-radius:9px}th{font-size:10px;padding:13px 12px}td{font-size:12px;padding:14px 12px}.date-label{font-size:11px}.alert{margin:12px 13px 0}.today-chip{font-size:10px;padding:8px}.avatar{width:34px;height:34px}.footer{padding-bottom:30px}}
@media(min-width:681px){.mobile-menu-btn,.sidebar-scrim{display:none}}
@media(max-width:380px){.stats-grid,.stats-grid.two{grid-template-columns:1fr}.stat-card{min-height:unset}.topbar-right{gap:8px}.today-chip{display:none}}
`;

export default App;