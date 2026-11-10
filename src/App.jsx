import React, { useEffect, useMemo, useState } from "react";
import { auth, db } from "./firebase";
import {
  onAuthStateChanged,
  GoogleAuthProvider,
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

// Group order items by restaurant for multi-restaurant breakdowns
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

// Render full order items categorized by restaurants
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
                    • {it.name || it.itemName || "Item"} × <strong>{it.quantity || 1}</strong>
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
  const [orders, setOrders] = useState([]);
  const [restaurants, setRestaurants] = useState([]);
  const [chargeRestaurantId, setChargeRestaurantId] = useState("");
  const [hiddenChargeInput, setHiddenChargeInput] = useState("0");
  const [chargeSearch, setChargeSearch] = useState("");
  const [riders, setRiders] = useState([]);
  const [managementEntries, setManagementEntries] = useState([]);
  const [onlineEntries, setOnlineEntries] = useState([]);
  const [locationsData, setLocationsData] = useState([]);
  const [firestorePaperReports, setFirestorePaperReports] = useState([]);
  const [page, setPage] = useState("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [restaurantId, setRestaurantId] = useState("");
  const [riderId, setRiderId] = useState("");
  const [overviewDate, setOverviewDate] = useState(todayKey());
  const [overviewSearch, setOverviewSearch] = useState("");
  const [overviewStatus, setOverviewStatus] = useState("all");
  const [resPageDate, setResPageDate] = useState(todayKey());
  const [resPageStatus, setResPageStatus] = useState("all");
  const [resPageSearch, setResPageSearch] = useState("");
  const [noteModalEntry, setNoteModalEntry] = useState(null);
  const [noteInputVal, setNoteInputVal] = useState("");
  const [riderPageDate, setRiderPageDate] = useState(todayKey());
  const [riderPageStatus, setRiderPageStatus] = useState("all");
  const [riderPageSearch, setRiderPageSearch] = useState("");
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
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [historyStart, setHistoryStart] = useState(todayKey());
  const [historyEnd, setHistoryEnd] = useState(todayKey());
  const [historyType, setHistoryType] = useState("restaurant");
  const [onlineMethod, setOnlineMethod] = useState("bKash");
  const [onlineAmount, setOnlineAmount] = useState("");
  const [onlineNote, setOnlineNote] = useState("");

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
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);
    } catch (error) {
      setAuthError(`Google sign-in failed: ${error.message}`);
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

    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }, [user]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), 3200);
    return () => clearTimeout(timer);
  }, [notice]);

  const selectedRestaurant =
    restaurants.find((item) => item.id === restaurantId) || restaurants[0];
  const selectedChargeRestaurant =
    restaurants.find((item) => item.id === chargeRestaurantId) || restaurants[0];

  useEffect(() => {
    if (!chargeRestaurantId && restaurants.length) {
      setChargeRestaurantId(restaurants[0].id);
    }
  }, [restaurants, chargeRestaurantId]);

  useEffect(() => {
    if (selectedChargeRestaurant) {
      const current = Number(selectedChargeRestaurant.hiddenDeliveryCharge ?? 0);
      setHiddenChargeInput(Number.isFinite(current) && current >= 0 ? String(current) : "0");
    }
  }, [chargeRestaurantId, restaurants]);

  async function saveHiddenDeliveryCharge(event) {
    event.preventDefault();
    if (!chargeRestaurantId) {
      setNotice({ type: "error", text: "Please select a restaurant first." });
      return;
    }
    const amount = Number(hiddenChargeInput);
    if (!Number.isFinite(amount) || amount < 0) {
      setNotice({ type: "error", text: "Enter a valid charge amount (0 or greater)." });
      return;
    }
    setSaving(true);
    try {
      await updateDoc(doc(db, COLLECTIONS.restaurants, chargeRestaurantId), {
        hiddenDeliveryCharge: amount,
        hiddenDeliveryChargeUpdatedAt: serverTimestamp(),
      });
      setRestaurants((current) =>
        current.map((item) =>
          item.id === chargeRestaurantId
            ? { ...item, hiddenDeliveryCharge: amount }
            : item
        )
      );
      setNotice({
        type: "success",
        text: `Hidden delivery charge updated for ${selectedChargeRestaurant?.name || "the selected restaurant"}.`,
      });
    } catch (error) {
      setNotice({ type: "error", text: `Could not save charge: ${error.message}` });
    } finally {
      setSaving(false);
    }
  }

  const selectedRider = riders.find((item) => item.id === riderId) || riders[0];

  useEffect(() => {
    if (!restaurantId && restaurants.length) setRestaurantId(restaurants[0].id);
  }, [restaurants, restaurantId]);

  useEffect(() => {
    if (!riderId && riders.length) setRiderId(riders[0].id);
  }, [riders, riderId]);

  async function handleBulkRestaurantAction(turnOn) {
    if (!selectedRestaurantIds.length) {
      setNotice({ type: "error", text: "Prothomay kompokhe ekti restaurant select korun." });
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

      const updatePromises = selectedRestaurantIds.map(async (resId) => {
        const resDocRef = doc(db, COLLECTIONS.restaurants, resId);
        const payload = turnOn
          ? {
              open: "yes",
              priority: 0,
              availableLocations: fallbackList,
            }
          : {
              open: "no",
              priority: 1000,
            };
        await updateDoc(resDocRef, payload);
      });

      await Promise.all(updatePromises);
      setNotice({
        type: "success",
        text: turnOn
          ? "Selected restaurant-gula open hoiche, priority 0 ebong sob locations & sub-locations select kora hoiche!"
          : "Selected restaurant-gula off hoiche ebong priority 1000 kora hoiche.",
      });
    } catch (error) {
      setNotice({ type: "error", text: `Action failed: ${error.message}` });
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
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += `Paper Work Report - Date: ${report.date}\n\n`;
    csvContent += "Name,Delivered,Online,Bill,Charge,Salary,Fine\n";
    report.rows.forEach((r) => {
      csvContent += `"${r.name}",${r.delivered},${r.online},${r.bill},${r.charge},${r.salary},${r.fine}\n`;
    });

    csvContent += `\nAll Total,,${report.totals.online},${report.totals.bill},${report.totals.charge},${report.totals.salary},${report.totals.fine}\n`;
    csvContent += `\nProfit Summary (Formula: Bill*9.41% + Charge),,${report.profit}\n`;

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `paper_work_report_${report.date}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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

  // RESTAURANTS PAGE ORDERS: Keep ALL items for complete breakdown display, but filter orders by restaurant and calculate subtotal ONLY for selected restaurant
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

  // Online Payment Page Computed Data (bKash, Nagad, Rocket)
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

  const riderCollectionEntry = managementEntries.find(
    (e) =>
      e.entityType === "rider" &&
      String(e.entityId) === String(riderId) &&
      dateKey(e.date || e.createdAt) === riderPageDate &&
      ["collection", "physical"].includes(normalized(e.type))
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

  const bKashTotal = onlineEntries
    .filter((entry) => normalized(entry.method) === "bkash")
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);

  const nagadTotal = onlineEntries
    .filter((entry) => normalized(entry.method) === "nagad")
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);

  const rocketTotal = onlineEntries
    .filter((entry) => normalized(entry.method) === "rocket")
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);

  const filteredOnline = onlineEntries
    .filter(
      (entry) =>
        normalized(entry.method) === normalized(onlineMethod) &&
        dateKey(entry.date || entry.createdAt) === selectedDate
    )
    .sort((a, b) => (asDate(b.createdAt)?.getTime() || 0) - (asDate(a.createdAt)?.getTime() || 0));

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

  async function saveOnlineEntry(event) {
    event.preventDefault();
    if (!onlineAmount || Number(onlineAmount) < 0) {
      setNotice({ type: "error", text: "Sothik amount din." });
      return;
    }
    setSaving(true);
    try {
      await addDoc(collection(db, COLLECTIONS.online), {
        method: onlineMethod,
        amount: Number(onlineAmount),
        note: onlineNote.trim(),
        date: selectedDate,
        createdAt: serverTimestamp(),
      });
      setOnlineAmount("");
      setOnlineNote("");
      setNotice({ type: "success", text: `${onlineMethod} entry saved.` });
    } catch (error) {
      setNotice({ type: "error", text: `Save failed: ${error.message}` });
    } finally {
      setSaving(false);
    }
  }

  const navItems = [
    ["overview", "Overview", "◫"],
    ["restaurants", "Restaurants", "▤"],
    ["delivery-charge", "Delivery Charge", "৳"],
    ["online-payment", "Online Payment", "💳"],
    ["riders", "Riders", "♧"],
    ["online", "Online Accounts", "৳"],
    ["history", "History & Reports", "▦"],
    ["bulk", "Bulk Management", "⚙"],
    ["paperwork", "Paper Work", "📄"],
  ];

  if (!authReady) {
    return (
      <div className="boot-screen">
        <div className="loader" />
        <p>Connecting to Firebase…</p>
      </div>
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
          <button className="nav-link" onClick={() => signOut(auth)}>Sign out</button>
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
          <section className="content">
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

        {/* 2. ONLINE PAYMENT REPORT PAGE (bKash, Nagad, Rocket) */}
        {page === "online-payment" && (
          <section className="content">
            <div className="section-heading print-hide">
              <div>
                <h2>Online Payment Orders Report</h2>
                <p>View bKash, Nagad, and Rocket payment records with customer details, payment amounts, and PDF download option.</p>
              </div>
              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <button className="primary-btn" onClick={() => window.print()} style={{ background: "#3b82f6" }}>🖨️ Print / Download PDF</button>
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
                <button className="primary-btn" onClick={() => window.print()} style={{ background: "#3b82f6" }}>🖨️ Print / Download PDF</button>
              </div>
            </div>
          </section>
        )}

        {/* 3. RESTAURANTS PAGE */}
        {page === "restaurants" && (
          <section className="content">
            <div className="section-heading">
              <div>
                <h2>Restaurant accounts & Orders</h2>
                <p>Full order breakdown with items & note. Amount is counted only for {selectedRestaurant?.name || "the selected restaurant"}.</p>
              </div>
            </div>

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

            <div className="panel" style={{ background: "#ffffff", border: "1px solid #e2e8f0", padding: "20px", borderRadius: "14px", marginBottom: "20px", boxShadow: "0 2px 7px rgba(20,33,59,0.03)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "15px" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "11px", fontWeight: "700", color: "#64748b", letterSpacing: "0.5px" }}>PHYSICAL CASH COLLECTION ({resPageDate})</span>
                    <button
                      style={{ background: "#eff6ff", color: "#3b82f6", border: "1px solid #bfdbfe", borderRadius: "6px", padding: "2px 8px", fontSize: "11px", fontWeight: "700", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "4px" }}
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
                  {restaurantPhysicalEntry?.note && (
                    <div style={{ fontSize: "12px", color: "#475569", marginTop: "4px", fontStyle: "italic" }}>
                      "{restaurantPhysicalEntry.note}"
                    </div>
                  )}
                </div>

                <div>
                  <button
                    className="primary-btn"
                    style={{ background: "#10b981", height: "40px", padding: "0 16px", display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: "800" }}
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
                    title="Edit Amount"
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
          </section>
        )}

        {/* 4. RIDERS PAGE */}
        {page === "riders" && (
          <section className="content">
            <div className="section-heading">
              <div>
                <h2>Rider accounts & Orders</h2>
                <p>View rider-specific orders with product details, calculated charges, and grand totals.</p>
              </div>
            </div>

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

            {/* Rider Top Summary Metric Grid Including Total Amount & Charge Box */}
            <div
              className="stats-grid orders-card-grid"
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", marginBottom: "20px" }}
            >
              <StatCard label="Delivered COD Total" value={money(riderPageStats.deliveredCod)} hint={`Delivered COD · ${riderPageDate}`} icon="৳" tone="green" />
              <StatCard label="Delivered Online Total" value={money(riderPageStats.deliveredOnline)} hint={`Delivered Online · ${riderPageDate}`} icon="💳" tone="blue" />
              <StatCard
                label="Total Amount (COD + Online)"
                value={money(riderPageStats.deliveredTotal)}
                hint="Total delivered collection"
                icon="Σ"
                tone="purple"
              />
              <StatCard
                label="Delivery Charge Box"
                value={money(riderPageStats.totalCharge)}
                hint="Total Amount - Product Amount"
                icon="⚡"
                tone="orange"
              />
              <StatCard label="Cancelled Orders Total" value={money(riderPageStats.cancelledTotal)} hint={`Cancelled · ${riderPageDate}`} icon="×" tone="red" />
            </div>

            <div className="stats-grid orders-card-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginBottom: "20px" }}>
              <div className="panel" style={{ background: "#ffffff", border: "1px solid #e2e8f0", padding: "20px", borderRadius: "14px", margin: 0, boxShadow: "0 2px 7px rgba(20,33,59,0.03)", display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: "150px" }}>
                <div>
                  <span style={{ fontSize: "11px", fontWeight: "800", color: "#64748b", letterSpacing: "0.5px" }}>COD COLLECTION</span>
                  <div style={{ fontSize: "28px", fontWeight: "900", color: "#0f172a", marginTop: "6px" }}>
                    {money(riderCollectionEntry ? riderCollectionEntry.amount : 0)}
                  </div>
                  {riderCollectionEntry?.note && (
                    <div style={{ fontSize: "12px", color: "#475569", marginTop: "4px", fontStyle: "italic" }}>
                      Note: "{riderCollectionEntry.note}"
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: "10px", borderTop: "1px solid #f1f5f9", marginTop: "15px", paddingTop: "12px" }}>
                  <button
                    style={{ flex: 1, background: "#eff6ff", color: "#3b82f6", border: "1px solid #bfdbfe", borderRadius: "8px", padding: "8px 12px", fontSize: "12px", fontWeight: "700", cursor: "pointer", display: "inline-flex", justifyContent: "center", alignItems: "center", gap: "6px" }}
                    onClick={() => {
                      setNoteModalEntry({
                        type: "collection",
                        entityType: "rider",
                        entityId: riderId,
                        entityName: selectedRider?.name || "Rider",
                        date: riderPageDate,
                        amount: riderCollectionEntry ? riderCollectionEntry.amount : 0,
                        note: riderCollectionEntry ? riderCollectionEntry.note || "" : "",
                      });
                      setNoteInputVal(riderCollectionEntry ? riderCollectionEntry.note || "" : "");
                    }}
                  >
                    📝 Note {riderCollectionEntry?.note ? "•" : ""}
                  </button>
                  <button
                    style={{ flex: 1, background: "#ecfdf5", color: "#059669", border: "1px solid #a7f3d0", borderRadius: "8px", padding: "8px 12px", fontSize: "12px", fontWeight: "700", cursor: "pointer", display: "inline-flex", justifyContent: "center", alignItems: "center", gap: "6px" }}
                    onClick={() => {
                      setEditModalData({
                        entityType: "rider",
                        entityId: riderId,
                        entityName: selectedRider?.name || "Rider",
                        type: "collection",
                        amount: riderCollectionEntry ? riderCollectionEntry.amount : 0,
                        date: riderPageDate,
                        title: "Edit COD Collection Amount",
                      });
                      setEditAmountVal(riderCollectionEntry ? riderCollectionEntry.amount : "");
                    }}
                  >
                    ✏️ Edit
                  </button>
                </div>
              </div>

              <div className="panel" style={{ background: "#ffffff", border: "1px solid #e2e8f0", padding: "20px", borderRadius: "14px", margin: 0, boxShadow: "0 2px 7px rgba(20,33,59,0.03)", display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: "150px" }}>
                <div>
                  <span style={{ fontSize: "11px", fontWeight: "800", color: "#64748b", letterSpacing: "0.5px" }}>FINE AMOUNT</span>
                  <div style={{ fontSize: "28px", fontWeight: "900", color: "#e25b56", marginTop: "6px" }}>
                    {money(riderFineEntry ? riderFineEntry.amount : 0)}
                  </div>
                  {riderFineEntry?.note && (
                    <div style={{ fontSize: "12px", color: "#475569", marginTop: "4px", fontStyle: "italic" }}>
                      Note: "{riderFineEntry.note}"
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: "10px", borderTop: "1px solid #f1f5f9", marginTop: "15px", paddingTop: "12px" }}>
                  <button
                    style={{ flex: 1, background: "#eff6ff", color: "#3b82f6", border: "1px solid #bfdbfe", borderRadius: "8px", padding: "8px 12px", fontSize: "12px", fontWeight: "700", cursor: "pointer", display: "inline-flex", justifyContent: "center", alignItems: "center", gap: "6px" }}
                    onClick={() => {
                      setNoteModalEntry({
                        type: "fine",
                        entityType: "rider",
                        entityId: riderId,
                        entityName: selectedRider?.name || "Rider",
                        date: riderPageDate,
                        amount: riderFineEntry ? riderFineEntry.amount : 0,
                        note: riderFineEntry ? riderFineEntry.note || "" : "",
                      });
                      setNoteInputVal(riderFineEntry ? riderFineEntry.note || "" : "");
                    }}
                  >
                    📝 Note {riderFineEntry?.note ? "•" : ""}
                  </button>
                  <button
                    style={{ flex: 1, background: "#ecfdf5", color: "#059669", border: "1px solid #a7f3d0", borderRadius: "8px", padding: "8px 12px", fontSize: "12px", fontWeight: "700", cursor: "pointer", display: "inline-flex", justifyContent: "center", alignItems: "center", gap: "6px" }}
                    onClick={() => {
                      setEditModalData({
                        entityType: "rider",
                        entityId: riderId,
                        entityName: selectedRider?.name || "Rider",
                        type: "fine",
                        amount: riderFineEntry ? riderFineEntry.amount : 0,
                        date: riderPageDate,
                        title: "Edit Fine Amount",
                      });
                      setEditAmountVal(riderFineEntry ? riderFineEntry.amount : "");
                    }}
                  >
                    ✏️ Edit
                  </button>
                </div>
              </div>

              <div className="panel" style={{ background: "#ffffff", border: "1px solid #e2e8f0", padding: "20px", borderRadius: "14px", margin: 0, boxShadow: "0 2px 7px rgba(20,33,59,0.03)", display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: "150px" }}>
                <div>
                  <span style={{ fontSize: "11px", fontWeight: "800", color: "#64748b", letterSpacing: "0.5px" }}>DAILY SALARY</span>
                  <div style={{ fontSize: "28px", fontWeight: "900", color: "#16a34a", marginTop: "6px" }}>
                    {money(riderSalaryEntry ? riderSalaryEntry.amount : 0)}
                  </div>
                  {riderSalaryEntry?.note && (
                    <div style={{ fontSize: "12px", color: "#475569", marginTop: "4px", fontStyle: "italic" }}>
                      Note: "{riderSalaryEntry.note}"
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: "10px", borderTop: "1px solid #f1f5f9", marginTop: "15px", paddingTop: "12px" }}>
                  <button
                    style={{ flex: 1, background: "#eff6ff", color: "#3b82f6", border: "1px solid #bfdbfe", borderRadius: "8px", padding: "8px 12px", fontSize: "12px", fontWeight: "700", cursor: "pointer", display: "inline-flex", justifyContent: "center", alignItems: "center", gap: "6px" }}
                    onClick={() => {
                      setNoteModalEntry({
                        type: "salary",
                        entityType: "rider",
                        entityId: riderId,
                        entityName: selectedRider?.name || "Rider",
                        date: riderPageDate,
                        amount: riderSalaryEntry ? riderSalaryEntry.amount : 0,
                        note: riderSalaryEntry ? riderSalaryEntry.note || "" : "",
                      });
                      setNoteInputVal(riderSalaryEntry ? riderSalaryEntry.note || "" : "");
                    }}
                  >
                    📝 Note {riderSalaryEntry?.note ? "•" : ""}
                  </button>
                  <button
                    style={{ flex: 1, background: "#ecfdf5", color: "#059669", border: "1px solid #a7f3d0", borderRadius: "8px", padding: "8px 12px", fontSize: "12px", fontWeight: "700", cursor: "pointer", display: "inline-flex", justifyContent: "center", alignItems: "center", gap: "6px" }}
                    onClick={() => {
                      setEditModalData({
                        entityType: "rider",
                        entityId: riderId,
                        entityName: selectedRider?.name || "Rider",
                        type: "salary",
                        amount: riderSalaryEntry ? riderSalaryEntry.amount : 0,
                        date: riderPageDate,
                        title: "Edit Salary Amount",
                      });
                      setEditAmountVal(riderSalaryEntry ? riderSalaryEntry.amount : "");
                    }}
                  >
                    ✏️ Edit
                  </button>
                </div>
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
          </section>
        )}

        {/* 5. ONLINE ACCOUNTS (bKash, Nagad, Rocket) */}
        {page === "online" && (
          <section className="content">
            <div className="section-heading">
              <div>
                <h2>Online accounts</h2>
                <p>bKash, Nagad, and Rocket transaction ledger</p>
              </div>
            </div>
            <div className="stats-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
              <StatCard label="Total bKash" value={money(bKashTotal)} hint="All saved entries" icon="B" tone="pink" />
              <StatCard label="Total Nagad" value={money(nagadTotal)} hint="All saved entries" icon="N" tone="orange" />
              <StatCard label="Total Rocket" value={money(rocketTotal)} hint="All saved entries" icon="R" tone="purple" />
              <StatCard label="Grand total" value={money(bKashTotal + nagadTotal + rocketTotal)} hint="bKash + Nagad + Rocket" icon="৳" tone="green" />
            </div>
            <div className="panel">
              <div className="tabs">
                <button className={onlineMethod === "bKash" ? "selected" : ""} onClick={() => setOnlineMethod("bKash")}>bKash</button>
                <button className={onlineMethod === "Nagad" ? "selected" : ""} onClick={() => setOnlineMethod("Nagad")}>Nagad</button>
                <button className={onlineMethod === "Rocket" ? "selected" : ""} onClick={() => setOnlineMethod("Rocket")}>Rocket</button>
              </div>
              <div className="filter-bar compact">
                <label>
                  Entry date
                  <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
                </label>
              </div>
              <form className="entry-form" onSubmit={saveOnlineEntry}>
                <label>
                  Amount (৳)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={onlineAmount}
                    onChange={(e) => setOnlineAmount(e.target.value)}
                    placeholder="0.00"
                    required
                  />
                </label>
                <label className="note-field">
                  Note
                  <input
                    value={onlineNote}
                    onChange={(e) => setOnlineNote(e.target.value)}
                    placeholder="Optional transaction note"
                  />
                </label>
                <button className="primary-btn" disabled={saving}>
                  {saving ? "Saving…" : `Add ${onlineMethod} entry`}
                </button>
              </form>
              <div className="panel-head list-heading">
                <div>
                  <h3>{onlineMethod} entries</h3>
                  <p>{selectedDate}</p>
                </div>
                <span className="count-pill">{filteredOnline.length} entries</span>
              </div>

              <div className="online-boxes-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "15px", marginTop: "20px" }}>
                {filteredOnline.map((entry, idx) => {
                  const colors = ["#ec4899", "#f59e0b", "#8b5cf6", "#3b82f6", "#10b981"];
                  const bColor = colors[idx % colors.length];
                  return (
                    <div
                      key={entry.id}
                      style={{
                        background: "#fff",
                        border: `2px solid ${bColor}`,
                        borderRadius: "12px",
                        padding: "14px",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                        position: "relative",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "6px" }}>
                        <span style={{ fontSize: "10px", fontWeight: "800", textTransform: "uppercase", color: "#64748b" }}>
                          {entry.method || onlineMethod}
                        </span>
                        <span style={{ fontSize: "10px", fontWeight: "700", color: "#334155" }}>
                          {formatDateTime(entry.createdAt || entry.date)}
                        </span>
                      </div>
                      <div style={{ fontSize: "22px", fontWeight: "900", color: "#0f172a", marginBottom: "4px" }}>
                        {money(entry.amount)}
                      </div>
                      <div style={{ fontSize: "11px", color: "#475569", fontStyle: "italic", marginBottom: "10px" }}>
                        "{entry.note || "No note"}"
                      </div>
                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <button
                          type="button"
                          style={{
                            background: "#fff1f0",
                            color: "#d35b54",
                            border: 0,
                            borderRadius: "6px",
                            padding: "5px 10px",
                            fontSize: "10px",
                            fontWeight: "800",
                            cursor: "pointer",
                            zIndex: 10,
                            position: "relative",
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteModalData({
                              collectionName: COLLECTIONS.online,
                              id: entry.id,
                              title: "Delete Online Entry",
                              message: "Are you sure you want to delete this online entry?",
                              onConfirm: async () => {
                                try {
                                  await deleteDoc(doc(db, COLLECTIONS.online, entry.id));
                                  setNotice({ type: "success", text: "Entry deleted successfully." });
                                } catch (err) {
                                  setNotice({ type: "error", text: `Delete failed: ${err.message}` });
                                }
                              },
                            });
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
                {filteredOnline.length === 0 && (
                  <div style={{ gridColumn: "1 / -1", textAlign: "center", color: "#9aa5b5", padding: "30px" }}>
                    No {onlineMethod} entries found for {selectedDate}.
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* 6. HISTORY & REPORTS */}
        {page === "history" && (
          <section className="content">
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
                <button className="primary-btn" onClick={() => window.print()} style={{ height: "38px", padding: "0 16px", background: "#3b82f6" }}>
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
                  <button className="primary-btn" onClick={() => window.print()} style={{ background: "#3b82f6" }}>🖨️ Print / Download PDF</button>
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
                  <button className="primary-btn" onClick={() => window.print()} style={{ background: "#3b82f6" }}>🖨️ Print / Download PDF</button>
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

        {/* 7. BULK RESTAURANT MANAGEMENT */}
        {page === "bulk" && (
          <section className="content">
            <div className="section-heading">
              <div>
                <h2>Bulk Restaurant Management</h2>
                <p>Multi-select restaurants and apply open status, priority 0, and all locations/sub-locations instantly</p>
              </div>
            </div>

            <div className="panel bulk-action-panel">
              <div className="panel-head">
                <div>
                  <h3>Restaurant Controls</h3>
                  <p>Select restaurants below and trigger Turn On or Turn Off</p>
                </div>
                <div className="bulk-actions-btns">
                  <button type="button" className="primary-btn on-btn" onClick={() => handleBulkRestaurantAction(true)} disabled={saving}>
                    {saving ? "Processing..." : "Turn On (Open, Priority 0, All Locations)"}
                  </button>
                  <button type="button" className="primary-btn off-btn" onClick={() => handleBulkRestaurantAction(false)} disabled={saving}>
                    {saving ? "Processing..." : "Turn Off (Close, Priority 1000)"}
                  </button>
                </div>
              </div>
              <div className="selection-controls">
                <button type="button" className="text-btn" onClick={selectAllRestaurants}>Select All</button>
                <button type="button" className="text-btn" onClick={clearSelectedRestaurants}>Clear Selection</button>
                <span className="count-pill">{selectedRestaurantIds.length} restaurants selected</span>
              </div>
              <div className="multi-select-grid">
                {restaurants.map((res) => {
                  const isSelected = selectedRestaurantIds.includes(res.id);
                  return (
                    <div
                      key={res.id}
                      className={`restaurant-checkbox-card ${isSelected ? "selected" : ""}`}
                      onClick={() => toggleRestaurantSelection(res.id)}
                    >
                      <input type="checkbox" checked={isSelected} onChange={() => {}} />
                      <span>{res.name || res.id}</span>
                      <small className="cell-sub">Status: {res.open || "N/A"} | Priority: {res.priority ?? "N/A"}</small>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* 8. PAPER WORK & REPORTS */}
        {page === "paperwork" && (
          <section className="content">
            <div className="section-heading print-hide">
              <div>
                <h2>Paper Work & Profit Calculation</h2>
                <p>Select riders, filter by date, view calculated metrics, manage salaries, and save permanent date-wise reports.</p>
              </div>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                <button className="primary-btn" onClick={saveCurrentPaperWorkReport}>💾 Save Permanent Report for {paperWorkDate}</button>
                <button className="primary-btn" onClick={() => window.print()} style={{ background: "#3b82f6" }}>Print / Download PDF View</button>
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
                      <button className="print-hide primary-btn" style={{ height: "32px", padding: "0 12px", background: "#3b82f6", fontSize: "11px" }} onClick={() => window.print()}>
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
                <button className="primary-btn" onClick={() => window.print()} style={{ background: "#3b82f6" }}>🖨️ Print / Download PDF</button>
                {activePaperworkPrintReport && (
                  <button className="primary-btn" onClick={() => setActivePaperworkPrintReport(null)} style={{ background: "#64748b" }}>Close Saved View</button>
                )}
              </div>
            </div>
          </section>
        )}

        {/* 9. DELIVERY CHARGE PAGE */}
        {page === "delivery-charge" && (
          <section className="content">
            <div className="section-heading">
              <div>
                <div className="eyebrow" style={{ marginBottom: 8 }}>RESTAURANT SETTINGS / DELIVERY</div>
                <h2>Restaurant delivery charge</h2>
                <p>Manage an additional delivery charge for each restaurant. Changes sync to the customer checkout configuration.</p>
              </div>
              <span className="date-label">Live Firestore settings</span>
            </div>

            <div className="stats-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
              <StatCard label="Restaurants available" value={restaurants.length} hint="Customer-facing restaurant records" icon="▤" tone="blue" />
              <StatCard label="Charges configured" value={restaurants.filter((r) => Number(r.hiddenDeliveryCharge || 0) > 0).length} hint="Restaurants with an extra charge" icon="৳" tone="green" />
              <StatCard label="No extra charge" value={restaurants.filter((r) => Number(r.hiddenDeliveryCharge || 0) <= 0).length} hint="Hidden delivery charge is ৳0" icon="✓" tone="purple" />
            </div>

            <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "22px 24px", background: "linear-gradient(120deg,#10243a 0%,#1d4050 58%,#176c59 100%)", color: "#fff" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9 }}>
                  <span style={{ width: 36, height: 36, borderRadius: 11, background: "#ffffff20", display: "grid", placeItems: "center", fontSize: 19 }}>৳</span>
                  <span style={{ fontSize: 11, letterSpacing: 1.4, fontWeight: 800, color: "#b8d8d1" }}>PER-RESTAURANT CONFIGURATION</span>
                </div>
                <h3 style={{ margin: 0, font: "800 21px 'Plus Jakarta Sans'" }}>Set hidden delivery charge</h3>
                <p style={{ margin: "7px 0 0", color: "#d0e2e0", fontSize: 12, lineHeight: 1.6 }}>Choose a restaurant and set its additional delivery amount in BDT. The value is stored directly in its `mini_restaurants` document.</p>
              </div>

              <form onSubmit={saveHiddenDeliveryCharge} style={{ padding: 24 }}>
                <div className="filter-bar" style={{ border: 0, padding: 0, margin: 0, background: "transparent", alignItems: "end" }}>
                  <label style={{ flex: "2 1 260px" }}>
                    Select restaurant
                    <select value={chargeRestaurantId} onChange={(e) => setChargeRestaurantId(e.target.value)} required>
                      <option value="">Choose a restaurant</option>
                      {restaurants.map((restaurant) => (
                        <option key={restaurant.id} value={restaurant.id}>{restaurant.name || restaurant.restaurantName || restaurant.id}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ flex: "1 1 190px" }}>
                    Hidden delivery charge (৳)
                    <input type="number" min="0" step="0.01" inputMode="decimal" value={hiddenChargeInput} onChange={(e) => setHiddenChargeInput(e.target.value)} placeholder="0.00" required />
                  </label>
                  <button className="primary-btn" type="submit" disabled={saving || !chargeRestaurantId} style={{ minWidth: 155, height: 42 }}>
                    {saving ? "Saving…" : "Save charge"}
                  </button>
                </div>

                {selectedChargeRestaurant ? (
                  <div style={{ marginTop: 22, padding: 16, border: "1px solid #e6edf2", borderRadius: 13, background: "#f8fbfa", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontSize: 10, color: "#8190a3", fontWeight: 800, letterSpacing: 1 }}>SELECTED RESTAURANT</div>
                      <strong style={{ display: "block", marginTop: 5, color: "#17243b", fontSize: 15 }}>{selectedChargeRestaurant.name || selectedChargeRestaurant.restaurantName || selectedChargeRestaurant.id}</strong>
                      <span style={{ display: "block", marginTop: 4, color: "#8794a5", fontSize: 10 }}>ID: {selectedChargeRestaurant.id}</span>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 10, color: "#8190a3", fontWeight: 800, letterSpacing: 1 }}>CURRENT SAVED CHARGE</div>
                      <div style={{ font: "800 25px 'Plus Jakarta Sans'", color: "#139968", marginTop: 3 }}>{money(selectedChargeRestaurant.hiddenDeliveryCharge || 0)}</div>
                    </div>
                  </div>
                ) : (
                  <div style={{ marginTop: 18, padding: 16, borderRadius: 11, background: "#fff8eb", color: "#9a6b22", fontSize: 12 }}>No restaurants found in the database.</div>
                )}
              </form>
            </div>

            <div className="panel">
              <div className="panel-head" style={{ gap: 14, flexWrap: "wrap" }}>
                <div><h3>Restaurant charge overview</h3><p>Current hidden delivery charge values from Firestore</p></div>
                <input value={chargeSearch} onChange={(e) => setChargeSearch(e.target.value)} placeholder="Search restaurant…" style={{ height: 36, border: "1px solid #e0e6ee", borderRadius: 8, padding: "0 11px", minWidth: 190, font: "12px 'DM Sans'" }} />
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Restaurant</th><th>Restaurant ID</th><th className="right">Hidden delivery charge</th><th>Status</th><th>Action</th></tr></thead>
                  <tbody>
                    {restaurants.filter((r) => normalized(r.name || r.restaurantName || r.id).includes(normalized(chargeSearch))).map((restaurant) => (
                      <tr key={restaurant.id}>
                        <td><strong>{restaurant.name || restaurant.restaurantName || restaurant.id}</strong></td>
                        <td><span className="cell-sub">{restaurant.id}</span></td>
                        <td className="right">{money(restaurant.hiddenDeliveryCharge || 0)}</td>
                        <td><span className={`status ${Number(restaurant.hiddenDeliveryCharge || 0) > 0 ? "good" : "pending"}`}>{Number(restaurant.hiddenDeliveryCharge || 0) > 0 ? "Configured" : "No extra charge"}</span></td>
                        <td><button type="button" className="text-btn" onClick={() => { setChargeRestaurantId(restaurant.id); setHiddenChargeInput(String(Number(restaurant.hiddenDeliveryCharge || 0))); }} style={{ border: 0, background: "#eaf7f1", color: "#13865d", borderRadius: 7, padding: "8px 11px", fontWeight: 800, cursor: "pointer" }}>Edit charge</button></td>
                      </tr>
                    ))}
                    {!restaurants.length && <tr><td colSpan="5" className="empty-cell">No restaurants found.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        <footer className="footer print-hide">Foodish Accounts · Firebase Firestore · Built for internal operations</footer>
      </main>

      {/* MODALS */}
      {noteModalEntry && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 50, display: "grid", placeItems: "center", padding: "16px" }}>
          <div style={{ background: "#fff", padding: "24px", borderRadius: "16px", width: "100%", maxWidth: "400px", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)" }}>
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
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 60, display: "grid", placeItems: "center", padding: "16px", backdropFilter: "blur(2px)" }}>
          <div style={{ background: "#fff", padding: "28px", borderRadius: "20px", width: "100%", maxWidth: "420px", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)" }}>
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
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 60, display: "grid", placeItems: "center", padding: "16px", backdropFilter: "blur(2px)" }}>
          <div style={{ background: "#fff", padding: "28px", borderRadius: "20px", width: "100%", maxWidth: "400px", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)", textAlign: "center" }}>
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
:root{font-family:'DM Sans',sans-serif;color:#172033;background:#f5f7fb;font-synthesis:none}
*{box-sizing:border-box}body{margin:0}.app-shell{min-height:100vh;display:flex;background:#f5f7fb}.sidebar{width:250px;background:#111b2e;color:#d5deed;min-height:100vh;padding:27px 17px;display:flex;flex-direction:column;position:fixed;inset:0 auto 0 0;z-index:5}.brand{display:flex;align-items:center;gap:11px;padding:0 10px 37px}.brand-mark{width:39px;height:39px;border-radius:13px;background:linear-gradient(145deg,#35c98b,#16a875);display:grid;place-items:center;color:white;font-weight:800;font-size:22px}.brand strong{display:block;color:#fff;font:800 18px 'Plus Jakarta Sans'}.brand small{display:block;color:#8190a8;font-size:9px;letter-spacing:1.4px;margin-top:3px}.side-label,.eyebrow{font-size:10px;font-weight:700;letter-spacing:1.5px;color:#8290a8}.side-label{padding:0 12px 12px}.sidebar nav{display:grid;gap:6px}.nav-link{border:0;background:transparent;color:#aab6c9;text-align:left;padding:12px;border-radius:10px;display:flex;align-items:center;gap:12px;font:600 13px 'DM Sans';cursor:pointer}.nav-link:hover{background:#1b2941;color:#fff}.nav-link.active{background:#203b3d;color:#6de0ad}.nav-icon{width:22px;text-align:center;font-size:18px}.sidebar-bottom{margin-top:auto;border-top:1px solid #26334a;padding:18px 10px 0;font-size:11px;color:#aab6c9}.sidebar-bottom small{display:block;color:#74839b;margin:7px 0 0 15px;font-size:10px}.online-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#35cf8b;margin-right:7px}.main-area{margin-left:250px;width:calc(100% - 250px);min-width:0}.topbar{height:91px;background:#fff;border-bottom:1px solid #e9edf4;display:flex;align-items:center;justify-content:space-between;padding:0 36px;position:sticky;top:0;z-index:4}.topbar h1{font:800 21px 'Plus Jakarta Sans';margin:5px 0 0;color:#18243a}.eyebrow{color:#93a0b3;font-size:9px}.topbar-right{display:flex;align-items:center;gap:12px}.refresh-btn{background:#e2e8f0;color:#1e293b;padding:0 14px;height:34px;font-size:11px;border-radius:17px}.refresh-btn:hover{background:#cbd5e1}.today-chip{font-size:11px;color:#64748b;background:#f2f8f5;padding:8px 12px;border-radius:20px}.today-chip span{color:#20b879;margin-right:5px}.avatar{width:34px;height:34px;background:#e6f6ef;color:#149966;border-radius:50%;display:grid;place-items:center;font-weight:800}.content{max-width:1440px;margin:0 auto;padding:30px 36px 18px}.section-heading{display:flex;justify-content:space-between;align-items:end;margin:0 0 22px}.section-heading h2{font:800 20px 'Plus Jakarta Sans';margin:0 0 5px}.section-heading p,.panel-head p{font-size:12px;color:#8a96a8;margin:0}.date-label{font-size:11px;color:#7c899d}.stats-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:15px;margin-bottom:20px}.stats-grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}.stat-card{background:#fff;border:1px solid #e9edf4;border-radius:14px;padding:18px;min-width:0;box-shadow:0 2px 7px #14213b05}.stat-icon{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;font-weight:800;font-size:16px;margin-bottom:13px}.stat-icon.green{background:#e7f8f0;color:#17a66d}.stat-icon.red{background:#fff0ef;color:#e25b56}.stat-icon.blue{background:#eaf2ff;color:#4c7de1}.stat-icon.purple{background:#f2edff;color:#8a69d5}.stat-icon.pink{background:#fff0f6;color:#d94e93}.stat-icon.orange{background:#fff3e8;color:#d98835}.stat-label{font-size:11px;color:#8290a3;font-weight:600}.stat-value{font:800 23px 'Plus Jakarta Sans';color:#17243b;margin:5px 0}.stat-hint{font-size:10px;color:#9aa5b5}.panel{background:#fff;border:1px solid #e8edf4;border-radius:14px;margin-bottom:19px;padding:20px;box-shadow:0 2px 7px #14213b05;min-width:0}.panel-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:17px}.panel-head h3{font:700 14px 'Plus Jakarta Sans';margin:0 0 5px}.count-pill{font-size:10px;background:#f1f5f9;color:#66758b;padding:6px 10px;border-radius:20px}.filter-bar{display:flex;align-items:end;gap:14px;flex-wrap:wrap;background:#fff;border:1px solid #e8edf4;border-radius:13px;padding:15px;margin-bottom:17px}.filter-bar label,.entry-form label{display:grid;gap:7px;color:#738096;font-size:10px;font-weight:700;min-width:160px}.filter-bar select,.filter-bar input,.entry-form input,.entry-form select{height:38px;border:1px solid #e0e6ee;border-radius:8px;background:#fff;padding:0 10px;color:#25324a;font:500 12px 'DM Sans';outline:none}.filter-bar select:focus,.filter-bar input:focus,.entry-form input:focus,.entry-form select:focus{border-color:#32b982;box-shadow:0 0 0 3px #32b98218}.table-wrap{width:100%;overflow-x:auto}table{width:100%;border-collapse:collapse;white-space:nowrap;text-align:left}th{font-size:13px;text-transform:uppercase;letter-spacing:.7px;color:#1e293b;background:#f8fafc;padding:14px 12px;font-weight:900}td{font-size:14px;color:#1e293b;padding:14px 12px;border-bottom:1px solid #f0f2f6;font-weight:700}tbody tr:last-child td{border-bottom:0}td strong{color:#0f172a;font-size:14px;font-weight:800}.right{text-align:right}.cell-sub{display:block;font-size:11px;color:#475569;margin-top:3px;font-weight:600}.status{display:inline-flex;padding:4px 8px;border-radius:20px;font-size:9px;font-weight:700;text-transform:capitalize}.status.good{background:#e8f8f0;color:#159b65}.status.bad{background:#fff0ef;color:#d85853}.status.pending{background:#fff7e8;color:#bb842b}.empty-cell{text-align:center;color:#9aa5b5;padding:28px}.entry-form{display:flex;align-items:end;gap:12px;flex-wrap:wrap;margin:2px 0 18px}.entry-form label{flex:1}.entry-form .note-field{flex:2;min-width:190px}.rider-entry-form label{min-width:145px}.primary-btn{height:42px;padding:0 20px;background:#17a873;border:0;border-radius:8px;color:#fff;font:800 13px 'DM Sans';cursor:pointer;white-space:nowrap}.primary-btn:hover{background:#108d60}.primary-btn:disabled{opacity:.6;cursor:wait}.delete-btn{border:0;background:#fff1f0;color:#d35b54;border-radius:6px;padding:8px 12px;font-size:11px;font-weight:800;cursor:pointer}.tabs{display:flex;gap:6px;border-bottom:1px solid #edf0f5;margin:-2px 0 15px}.tabs button{background:none;border:0;padding:10px 17px;color:#8995a6;font:700 12px 'DM Sans';cursor:pointer;border-bottom:2px solid transparent}.tabs button.selected{color:#159b68;border-color:#20b77a}.compact{border:0;padding:0;margin:0 0 15px}.list-heading{margin-top:20px}.footer{text-align:center;color:#a4adbb;font-size:10px;padding:14px 20px 24px}.loading-line{height:3px;background:#e7f5ee;color:#258d65;font-size:10px;padding-left:36px}.loading-line span{display:block;height:3px;width:35%;background:#22b77b;animation:load 1.5s infinite}@keyframes load{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}.alert{margin:18px 36px 0;padding:12px 14px;border-radius:9px;font-size:11px}.error-alert{background:#fff0ef;color:#b94c47}.toast{position:fixed;right:24px;bottom:24px;z-index:20;background:#14243a;color:white;border-radius:10px;padding:13px 17px;box-shadow:0 12px 35px #14213b30;font-size:12px;display:flex;gap:9px;align-items:center;max-width:min(440px,calc(100vw - 32px));animation:pop .2s ease}.toast.success span{color:#56dfa1}.toast.error span{color:#ff8880}@keyframes pop{from{transform:translateY(10px);opacity:0}to{transform:translateY(0);opacity:1}}.saving-overlay{position:fixed;inset:0;background:#0e1a2b70;z-index:30;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;gap:12px;font-size:12px}.loader{width:31px;height:31px;border:3px solid #d9eee5;border-top-color:#18a873;border-radius:50%;animation:spin .7s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.boot-screen{min-height:100vh;display:grid;place-content:center;justify-items:center;gap:12px;background:#f5f7fb;color:#66758b;font:12px 'DM Sans'}.error-panel{max-width:480px;background:#fff;padding:25px;border:1px solid #f1cecb;border-radius:12px;color:#a74440}.error-panel h2{font-size:17px}.error-panel p{font-size:12px;line-height:1.6}
.login-page{min-height:100vh;position:relative;isolation:isolate;overflow:hidden;display:grid;place-items:center;padding:32px 18px;background:radial-gradient(ellipse at 15% 10%,#e1f8ed 0,transparent 34%),radial-gradient(ellipse at 90% 90%,#e6edff 0,transparent 36%),linear-gradient(135deg,#f8fbff 0%,#f1f6f8 48%,#f8faff 100%);font-family:'DM Sans',sans-serif;color:#17243b}
.login-glow{position:absolute;z-index:-1;border-radius:50%;filter:blur(2px);pointer-events:none}.login-glow-one{width:330px;height:330px;left:-130px;top:18%;background:#b8f0d7;opacity:.32}.login-glow-two{width:390px;height:390px;right:-150px;bottom:4%;background:#c8d8ff;opacity:.32}
.login-card{width:min(100%,460px);padding:48px 44px 36px;border:1px solid #e7edf2;border-radius:25px;background:rgba(255,255,255,.92);box-shadow:0 24px 70px rgba(28,48,75,.11),0 3px 10px rgba(28,48,75,.04);text-align:center;backdrop-filter:blur(14px)}
.login-brand-mark{width:58px;height:58px;margin:0 auto 15px;border-radius:19px;display:grid;place-items:center;background:linear-gradient(145deg,#35c98b,#109b68);box-shadow:0 9px 22px rgba(22,168,117,.25);color:#fff;font:800 30px 'Plus Jakarta Sans'}
.login-brand-name{font:800 25px 'Plus Jakarta Sans';letter-spacing:-.8px;color:#17243b}.login-brand-name span{color:#18a873}
.login-kicker{margin-top:7px;color:#95a2b2;font-size:9px;font-weight:800;letter-spacing:1.7px}
.login-divider{height:1px;background:#edf1f5;margin:28px 0 25px}
.login-card h1{margin:0;color:#17243b;font:800 27px 'Plus Jakarta Sans';letter-spacing:-.8px}
.login-description{margin:10px 0 25px;color:#78869a;font-size:13px;line-height:1.8}
.google-login-button{width:100%;height:52px;display:flex;align-items:center;justify-content:center;gap:13px;border:1px solid #dce3eb;border-radius:11px;background:#fff;color:#26364b;font:700 13px 'DM Sans';cursor:pointer;box-shadow:0 3px 8px rgba(24,40,65,.04);transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}
.google-login-button:hover{transform:translateY(-2px);border-color:#b8c9d7;box-shadow:0 9px 20px rgba(24,40,65,.09)}
.google-g{font:800 19px Arial,sans-serif;background:conic-gradient(from -45deg,#4285f4 0 25%,#34a853 25% 50%,#fbbc05 50% 75%,#ea4335 75%);background-clip:text;-webkit-background-clip:text;color:transparent}
.google-arrow{margin-left:auto;color:#8b98a9;font-size:17px;font-weight:500}
.login-error{display:grid;gap:5px;text-align:left;margin:0 0 17px;padding:12px 14px;border:1px solid #f3c9c6;border-radius:10px;background:#fff5f4;color:#a63f39;font-size:11px;line-height:1.6;overflow-wrap:anywhere}
.login-error strong{font-size:12px}
.login-security{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:22px;color:#96a2b1;font-size:10px}
.security-dot{width:7px;height:7px;border-radius:50%;background:#20b77a;box-shadow:0 0 0 4px #e5f8ef}
.login-footer{position:absolute;bottom:18px;left:12px;right:12px;text-align:center;color:#a1adba;font-size:10px}
.bulk-action-panel { background: #fafbfc; border: 1px solid #e1e7ef; }
.bulk-actions-btns { display: flex; gap: 10px; flex-wrap: wrap; }
.on-btn { background: #17a873; }
.off-btn { background: #e25b56; }
.off-btn:hover { background: #c54843; }
.selection-controls { display: flex; align-items: center; gap: 12px; margin-bottom: 15px; }
.text-btn { background: none; border: 0; color: #17a873; font-weight: 700; font-size: 12px; cursor: pointer; padding: 0; }
.text-btn:hover { text-decoration: underline; }
.multi-select-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; max-height: 250px; overflow-y: auto; padding: 4px; border: 1px solid #e9edf4; border-radius: 8px; background: #fff; }
.restaurant-checkbox-card { display: flex; flex-direction: column; gap: 3px; padding: 10px; border: 1px solid #e2e8f0; border-radius: 8px; cursor: pointer; background: #fdfdfd; transition: all 0.15s ease; }
.restaurant-checkbox-card:hover { border-color: #cbd5e1; background: #f8fafc; }
.restaurant-checkbox-card.selected { border-color: #17a873; background: #f0fdf4; box-shadow: 0 0 0 1px #17a873; }
.restaurant-checkbox-card span { font-weight: 800; font-size: 14px; color: #0f172a; }
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
border-radius: 14px;
margin-bottom: 16px;
padding: 16px;
box-shadow: 0 4px 14px rgba(0,0,0,0.05);
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
@media print {
@page {
size: A4 portrait;
margin: 5mm;
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
@media(max-width:680px){.sidebar{width:270px;max-width:82vw;padding:22px 17px;transform:translateX(-105%);transition:transform .32s cubic-bezier(.2,.8,.2,1);box-shadow:18px 0 50px #101b2e24}.sidebar.sidebar-open{transform:translateX(0)}.brand{padding:0 8px 30px}.brand>div:last-child,.side-label,.nav-link span:last-child,.sidebar-bottom{display:block}.nav-link{justify-content:flex-start;padding:14px 12px;min-height:46px}.main-area{margin-left:0;width:100%}.topbar{height:72px;padding:0 14px 0 58px;position:sticky}.mobile-menu-btn{display:grid;place-items:center;position:absolute;left:13px;top:18px;width:34px;height:34px;border:1px solid #e7edf2;border-radius:9px;background:#fff;color:#26364b;font-size:18px;cursor:pointer}.sidebar-scrim{display:block;position:fixed;inset:0;background:#0d1728a6;border:0;z-index:4;backdrop-filter:blur(2px)}.topbar h1{font-size:18px}.content{padding:20px 14px 30px}.section-heading{align-items:start;gap:10px;flex-direction:column}.section-heading h2{font-size:19px}.stats-grid,.stats-grid.two{grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}.stat-card{padding:15px;min-height:130px;border-radius:15px}.stat-icon{width:38px;height:38px}.stat-value{font-size:clamp(18px,5vw,23px)}.stat-label{font-size:11px}.stat-hint{font-size:10px;line-height:1.45}.panel{padding:15px;border-radius:14px}.filter-bar{padding:13px;gap:12px}.filter-bar label{flex:1 1 100%;min-width:0;font-size:11px}.filter-bar select,.filter-bar input,.entry-form input,.entry-form select{height:44px;font-size:14px}.entry-form{display:grid;grid-template-columns:1fr;gap:13px}.entry-form label,.entry-form .note-field{min-width:0}.entry-form label{font-size:11px}.entry-form .primary-btn{width:100%;height:46px;font-size:13px}.primary-btn,.delete-btn{min-height:40px}.table-wrap{border-radius:9px}th{font-size:10px;padding:13px 12px}td{font-size:12px;padding:14px 12px}.date-label{font-size:11px}.alert{margin:12px 13px 0}.today-chip{font-size:10px;padding:8px}.avatar{width:34px;height:34px}.footer{padding-bottom:30px}}
@media(min-width:681px){.mobile-menu-btn,.sidebar-scrim{display:none}}
@media(max-width:380px){.stats-grid,.stats-grid.two{grid-template-columns:1fr}.stat-card{min-height:unset}.topbar-right{gap:8px}.today-chip{display:none}}
`;

export default App;