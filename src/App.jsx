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
};

const money = (value) =>
  `৳${Number(value || 0).toLocaleString("en-BD", {
    maximumFractionDigits: 2,
  })}`;

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
  const [riders, setRiders] = useState([]);
  const [managementEntries, setManagementEntries] = useState([]);
  const [onlineEntries, setOnlineEntries] = useState([]);
  const [locationsData, setLocationsData] = useState([]);

  const [page, setPage] = useState("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [restaurantId, setRestaurantId] = useState("");
  const [riderId, setRiderId] = useState("");

  const [selectedRestaurantIds, setSelectedRestaurantIds] = useState(() => {
    try {
      const saved = localStorage.getItem("cityfood_selected_restaurants");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [paperWorkRiderIds, setPaperWorkRiderIds] = useState(() => {
    try {
      const saved = localStorage.getItem("cityfood_paperwork_riders");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [paperWorkDate, setPaperWorkDate] = useState(todayKey());

  const [savedPaperWorkReports, setSavedPaperWorkReports] = useState(() => {
    try {
      const saved = localStorage.getItem("cityfood_saved_paperwork_reports");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("cityfood_saved_paperwork_reports", JSON.stringify(savedPaperWorkReports));
    } catch (e) {
      console.error(e);
    }
  }, [savedPaperWorkReports]);

  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [historyStart, setHistoryStart] = useState(todayKey());
  const [historyEnd, setHistoryEnd] = useState(todayKey());
  const [historyType, setHistoryType] = useState("restaurant");
  const [onlineMethod, setOnlineMethod] = useState("bKash");

  const [entryAmount, setEntryAmount] = useState("");
  const [entryNote, setEntryNote] = useState("");
  const [riderCollectionAmount, setRiderCollectionAmount] = useState("");
  const [riderFineAmount, setRiderFineAmount] = useState("");
  const [riderSalaryAmount, setRiderSalaryAmount] = useState("");
  const [onlineAmount, setOnlineAmount] = useState("");
  const [onlineNote, setOnlineNote] = useState("");

  useEffect(() => {
    try {
      localStorage.setItem("cityfood_selected_restaurants", JSON.stringify(selectedRestaurantIds));
    } catch (e) {
      console.error(e);
    }
  }, [selectedRestaurantIds]);

  useEffect(() => {
    try {
      localStorage.setItem("cityfood_paperwork_riders", JSON.stringify(paperWorkRiderIds));
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

  async function handleUpdateSalary(riderIdToUpdate, newSalaryValue) {
    setSaving(true);
    try {
      const existingEntry = managementEntries.find(
        (entry) =>
          entry.entityType === "rider" &&
          String(entry.entityId) === String(riderIdToUpdate) &&
          dateKey(entry.date || entry.createdAt) === paperWorkDate &&
          normalized(entry.type) === "salary"
      );

      const riderObj = riders.find((r) => r.id === riderIdToUpdate);
      const riderName = riderObj ? riderObj.name : "Rider";

      const payload = {
        entityType: "rider",
        entityId: riderIdToUpdate,
        entityName: riderName,
        type: "salary",
        amount: Number(newSalaryValue || 0),
        date: paperWorkDate,
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
      setNotice({ type: "success", text: "Salary updated successfully." });
    } catch (error) {
      setNotice({ type: "error", text: `Salary update failed: ${error.message}` });
    } finally {
      setSaving(false);
    }
  }

  const ridersWithBill = useMemo(() => {
    return riders.map((r) => {
      const riderOrders = orders.filter((o) => {
        return (
          String(o.riderId || "") === String(r.id) &&
          dateKey(o.createdAt) === paperWorkDate &&
          isDelivered(o)
        );
      });
      const bill = riderOrders.reduce((sum, o) => sum + itemSubtotal(o.items), 0);
      return { ...r, calculatedBill: bill };
    }).sort((a, b) => b.calculatedBill - a.calculatedBill);
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
    return (paperWorkTotals.bill * 0.094) + paperWorkTotals.charge;
  }, [paperWorkTotals]);

  // Save current Paper Work report permanently (Snapshot)
  const saveCurrentPaperWorkReport = () => {
    const reportData = {
      id: `report-${paperWorkDate}-${Date.now()}`,
      date: paperWorkDate,
      savedAt: new Date().toISOString(),
      rows: JSON.parse(JSON.stringify(paperWorkTableRows)), // Deep copy for permanent snapshot
      totals: { ...paperWorkTotals },
      profit: calculatedProfit,
    };

    setSavedPaperWorkReports((prev) => {
      const filtered = prev.filter((item) => item.date !== paperWorkDate);
      return [reportData, ...filtered];
    });
    setNotice({ type: "success", text: `Paper Work report for ${paperWorkDate} permanently saved!` });
  };

  // Delete saved report
  const deleteSavedReport = (reportDate) => {
    if (!window.confirm(`Are you sure you want to delete the saved report for ${reportDate}?`)) return;
    setSavedPaperWorkReports((prev) => prev.filter((item) => item.date !== reportDate));
    setNotice({ type: "success", text: "Saved report deleted successfully." });
  };

  const downloadSavedReportCSV = (report) => {
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += `Paper Work Report - Date: ${report.date}\n\n`;
    csvContent += "Name,Delivered,Online,Bill,Charge,Salary,Fine\n";

    report.rows.forEach((r) => {
      csvContent += `"${r.name}",${r.delivered},${r.online},${r.bill},${r.charge},${r.salary},${r.fine}\n`;
    });

    csvContent += `\nAll Total,,${report.totals.online},${report.totals.bill},${report.totals.charge},${report.totals.salary},${report.totals.fine}\n`;
    csvContent += `\nProfit Summary (Formula: Bill*9.4% + Charge),,${report.profit}\n`;

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `paper_work_report_${report.date}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadSavedReportPDF = (report) => {
    setPaperWorkDate(report.date);
    setTimeout(() => {
      window.print();
    }, 200);
  };

  const todaysOrders = useMemo(
    () => orders.filter((order) => dateKey(order.createdAt) === todayKey()),
    [orders]
  );
  const deliveredToday = todaysOrders.filter(isDelivered);
  const cancelledToday = todaysOrders.filter(isCancelled);
  const deliveredTotal = deliveredToday.reduce((sum, order) => sum + orderAmount(order), 0);
  const cancelledTotal = cancelledToday.reduce((sum, order) => sum + orderAmount(order), 0);
  const codTotal = deliveredToday
    .filter(isCOD)
    .reduce((sum, order) => sum + orderAmount(order), 0);

  const restaurantOrders = useMemo(() => {
    if (!selectedRestaurant) return [];
    return orders
      .filter((order) => {
        const matchesDate = dateKey(order.createdAt) === selectedDate;
        const matchesDel = isDelivered(order);
        const subtotal = itemSubtotal(order.items, selectedRestaurant.name, selectedRestaurant.id);
        return matchesDate && matchesDel && subtotal > 0;
      })
      .map((order) => ({
        ...order,
        restaurantSubtotal: itemSubtotal(order.items, selectedRestaurant.name, selectedRestaurant.id),
      }));
  }, [orders, selectedDate, selectedRestaurant]);

  const restaurantSales = restaurantOrders
    .reduce((sum, order) => sum + order.restaurantSubtotal, 0);

  const riderOrders = useMemo(() => {
    if (!selectedRider) return [];
    return orders.filter(
      (order) =>
        dateKey(order.createdAt) === selectedDate &&
        String(order.riderId || "") === String(selectedRider.id) &&
        isDelivered(order)
    );
  }, [orders, selectedDate, selectedRider]);

  const riderCOD = riderOrders
    .filter(isCOD)
    .reduce((sum, order) => sum + orderAmount(order), 0);

  const selectedDateManagement = managementEntries.filter(
    (entry) => dateKey(entry.date || entry.createdAt) === selectedDate
  );
  const restaurantPhysicalTotal = selectedDateManagement
    .filter((entry) => entry.entityType === "restaurant" && String(entry.entityId) === String(restaurantId) && ["collection", "physical"].includes(normalized(entry.type)))
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const riderDateEntries = selectedDateManagement.filter(
    (entry) => entry.entityType === "rider" && String(entry.entityId) === String(riderId)
  );
  const riderCollectionTotal = riderDateEntries.filter((entry) => ["collection", "physical"].includes(normalized(entry.type))).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const riderFineTotal = riderDateEntries.filter((entry) => normalized(entry.type) === "fine").reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const riderSalaryTotal = riderDateEntries.filter((entry) => normalized(entry.type) === "salary").reduce((sum, entry) => sum + Number(entry.amount || 0), 0);

  const bKashTotal = onlineEntries
    .filter((entry) => normalized(entry.method) === "bkash")
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const nagadTotal = onlineEntries
    .filter((entry) => normalized(entry.method) === "nagad")
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const filteredOnline = onlineEntries
    .filter(
      (entry) =>
        normalized(entry.method) === normalized(onlineMethod) &&
        dateKey(entry.date || entry.createdAt) === selectedDate
    )
    .sort((a, b) => (asDate(b.createdAt)?.getTime() || 0) - (asDate(a.createdAt)?.getTime() || 0));

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
    }),
    { sales: 0, collection: 0, cod: 0, fine: 0, salary: 0, bkash: 0, nagad: 0 }
  );

  async function upsertManagementEntry({ entityType, entity, type, amount, note }) {
    const matching = managementEntries.filter((entry) =>
      entry.entityType === entityType &&
      String(entry.entityId) === String(entity.id) &&
      dateKey(entry.date || entry.createdAt) === selectedDate &&
      (normalized(entry.type) === normalized(type) || (entityType === "restaurant" && type === "physical" && normalized(entry.type) === "collection"))
    );
    const payload = {
      entityType,
      entityId: entity.id,
      entityName: entity.name || "Unknown",
      type,
      amount: Number(amount),
      note: (note || "").trim(),
      date: selectedDate,
      updatedAt: serverTimestamp(),
    };
    if (matching.length) {
      await updateDoc(doc(db, COLLECTIONS.management, matching[0].id), payload);
      await Promise.all(matching.slice(1).map((entry) => deleteDoc(doc(db, COLLECTIONS.management, entry.id))));
    } else {
      await addDoc(collection(db, COLLECTIONS.management), {
        ...payload,
        createdAt: serverTimestamp(),
      });
    }
  }

  async function saveManagementEntry(event) {
    event.preventDefault();
    if (!selectedRestaurant && page === "restaurants") return;
    if (!selectedRider && page === "riders") return;

    const entityType = page === "riders" ? "rider" : "restaurant";
    const entity = entityType === "rider" ? selectedRider : selectedRestaurant;
    const entriesToSave = page === "restaurants"
      ? [{ type: "physical", amount: entryAmount }]
      : [
          { type: "collection", amount: riderCollectionAmount },
          { type: "fine", amount: riderFineAmount },
          { type: "salary", amount: riderSalaryAmount },
        ].filter((entry) => entry.amount !== "");

    if (!entriesToSave.length || entriesToSave.some((entry) => entry.amount === "" || !Number.isFinite(Number(entry.amount)) || Number(entry.amount) < 0)) {
      setNotice({ type: "error", text: "Sothik amount din." });
      return;
    }

    setSaving(true);
    try {
      for (const entry of entriesToSave) {
        await upsertManagementEntry({
          entityType,
          entity,
          type: entry.type,
          amount: entry.amount,
          note: entryNote,
        });
      }
      setEntryAmount("");
      setRiderCollectionAmount("");
      setRiderFineAmount("");
      setRiderSalaryAmount("");
      setEntryNote("");
      setNotice({ type: "success", text: "Hisab songrokkhon hoyeche." });
    } catch (error) {
      setNotice({ type: "error", text: `Save failed: ${error.message}` });
    } finally {
      setSaving(false);
    }
  }

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

  async function removeEntry(collectionName, id) {
    if (!window.confirm("Ei entry-ti delete korben?")) return;
    try {
      await deleteDoc(doc(db, collectionName, id));
      setNotice({ type: "success", text: "Entry deleted successfully." });
    } catch (error) {
      setNotice({ type: "error", text: `Delete failed: ${error.message}` });
    }
  }

  // Exact navigation order requested: Overview, Restaurants, Riders, Online Accounts, History & Reports, Bulk Management, Paper Work[cite: 14]
  const navItems = [
    ["overview", "Overview", "◫"],
    ["restaurants", "Restaurants", "▤"],
    ["riders", "Riders", "♧"],
    ["online", "Online Accounts", "৳"],
    ["history", "History & Reports", "▦"],
    ["bulk", "Bulk Management", "⚙"],
    ["paperwork", "Paper Work", "📄"],
  ];

  if (!authReady) {
    return <div className="boot-screen"><div className="loader" /><p>Connecting to Firebase…</p></div>;
  }

  if (!user) {
    return (
      <>
        <style>{styles}</style>
        <div className="login-page">
          <div className="login-glow login-glow-one" />
          <div className="login-glow login-glow-two" />
          <main className="login-card">
            <div className="login-brand-mark">C</div>
            <div className="login-brand-name">CityFood <span>Admin</span></div>
            <div className="login-kicker">ACCOUNTS & OPERATIONS CONSOLE</div>
            <div className="login-divider" />
            <h1>Welcome back</h1>
            <p className="login-description">Apnar CityFood Admin account diye login korun.</p>
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
          <footer className="login-footer">© {new Date().getFullYear()} CityFood · Internal use only</footer>
        </div>
      </>
    );
  }

  const historySavedEntries = historyType === "rider"
    ? [
        ...managementEntries.filter((entry) => {
          const d = dateKey(entry.date || entry.createdAt);
          return d >= historyStart && d <= historyEnd && entry.entityType === "rider" && String(entry.entityId) === String(riderId);
        }),
        ...orders.filter((order) => {
          const d = dateKey(order.createdAt);
          return d >= historyStart && d <= historyEnd && String(order.riderId || "") === String(riderId) && isDelivered(order) && isCOD(order);
        }).map((order) => ({
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
        return d >= historyStart && d <= historyEnd && (historyType === "online" ? true : entry.entityType === historyType && String(entry.entityId) === String(restaurantId));
      });

  return (
    <div className="app-shell">
      <style>{styles}</style>
      {sidebarOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">C</div>
          <div><strong>CityFood</strong><small>ACCOUNTS CONSOLE</small></div>
        </div>
        <div className="side-label">WORKSPACE</div>
        <nav>
          {navItems.map(([id, label, icon]) => (
            <button key={id} className={`nav-link ${page === id ? "active" : ""}`} onClick={() => { setPage(id); setSidebarOpen(false); }}>
              <span className="nav-icon">{icon}</span><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="online-dot" /> Firebase connected
          <small>{user?.email}</small><button className="nav-link" onClick={() => signOut(auth)}>Sign out</button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div>
            <button className="mobile-menu-btn" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}>☰</button>
            <div className="eyebrow">CITYFOOD / FINANCE</div>
            <h1>{navItems.find(([id]) => id === page)?.[1]}</h1>
          </div>
          <div className="topbar-right">
            <div className="today-chip"><span>●</span> Live data</div>
            <div className="avatar">{(user?.displayName || user?.email || "A").slice(0, 1).toUpperCase()}</div>
          </div>
        </header>

        {dataError && <div className="alert error-alert">{dataError}</div>}
        {loading && <div className="loading-line"><span /> Syncing Firestore data…</div>}

        {page === "overview" && (
          <section className="content">
            <div className="section-heading"><div><h2>Daily performance</h2><p>Ajker order o financial sarangsho</p></div><span className="date-label">{new Date().toLocaleDateString("en-BD", { dateStyle: "full" })}</span></div>
            <div className="stats-grid">
              <StatCard label="Delivered total" value={money(deliveredTotal)} hint={`${deliveredToday.length} delivered orders`} icon="↗" tone="green" />
              <StatCard label="Cancelled total" value={money(cancelledTotal)} hint={`${cancelledToday.length} cancelled orders`} icon="×" tone="red" />
              <StatCard label="Delivered COD" value={money(codTotal)} hint="Cash on delivery" icon="৳" tone="blue" />
              <StatCard label="Today's orders" value={todaysOrders.length.toLocaleString()} hint="All placed orders today" icon="▤" tone="purple" />
            </div>
            <div className="panel">
              <div className="panel-head"><div><h3>Recent orders</h3><p>Latest orders from Firestore</p></div><span className="count-pill">{todaysOrders.length} today</span></div>
              <OrderTable orders={[...orders].sort((a,b) => (asDate(b.createdAt)?.getTime() || 0) - (asDate(a.createdAt)?.getTime() || 0)).slice(0, 8)} />
            </div>
          </section>
        )}

        {/* Paper Work Page with Permanent Save, Snapshot Archive, and Delete Option */}
        {page === "paperwork" && (
          <section className="content">
            <div className="section-heading print-hide">
              <div>
                <h2>Paper Work & Profit Calculation</h2>
                <p>Select riders, filter by date, view calculated metrics, manage salaries, and save permanent date-wise reports.</p>
              </div>
              <div style={{ display: "flex", gap: "10px" }}>
                <button className="primary-btn" onClick={saveCurrentPaperWorkReport}>💾 Save Permanent Report for {paperWorkDate}</button>
                <button className="primary-btn" onClick={() => window.print()}>Print / Download PDF View</button>
              </div>
            </div>

            <div className="panel print-hide">
              <div className="filter-bar">
                <label>
                  Paper Work Date
                  <input type="date" value={paperWorkDate} onChange={(e) => setPaperWorkDate(e.target.value)} />
                </label>
              </div>

              {/* Riders Multi-Select Cards with Date-wise Bill and Sorted */}
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

            {/* Saved Reports Archive List with Delete Option */}
            {savedPaperWorkReports.length > 0 && (
              <div className="panel print-hide">
                <div className="panel-head">
                  <div>
                    <h3>Saved Paper Work Reports Archive (Permanent)</h3>
                    <p>Download CSV/PDF or delete previously saved permanent reports</p>
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
                      {savedPaperWorkReports.map((rep) => (
                        <tr key={rep.date}>
                          <td><strong>{rep.date}</strong></td>
                          <td>{formatDateTime(rep.savedAt)}</td>
                          <td>{money(rep.profit)}</td>
                          <td className="right" style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                            <button className="primary-btn" style={{ height: "30px", padding: "0 12px", fontSize: "11px" }} onClick={() => downloadSavedReportCSV(rep)}>
                              📥 CSV
                            </button>
                            <button className="primary-btn" style={{ height: "30px", padding: "0 12px", fontSize: "11px", background: "#3b82f6" }} onClick={() => downloadSavedReportPDF(rep)}>
                              🖨️ PDF
                            </button>
                            <button className="delete-btn" style={{ height: "30px", padding: "0 12px", fontSize: "11px" }} onClick={() => deleteSavedReport(rep.date)}>
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

            {/* Printable Area Wrapper for Table & Profit Summary */}
            <div className="printable-report-area">
              {/* Print Header: FOODISH STATEMENT & Date */}
              <div className="print-only-header" style={{ display: "none", textAlign: "center", marginBottom: "25px" }}>
                <h1 style={{ fontSize: "32px", fontWeight: "900", color: "#111b2e", margin: "0 0 5px", letterSpacing: "1px" }}>FOODISH STATEMENT</h1>
                <p style={{ fontSize: "16px", fontWeight: "700", color: "#475569", margin: 0 }}>Date: {paperWorkDate}</p>
              </div>

              <div className="panel">
                <div className="panel-head">
                  <div>
                    <h3>Performance & Ledger Table</h3>
                    <p>Date: {paperWorkDate}</p>
                  </div>
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
                        <th>Salary (Editable)</th>
                        <th>Fine</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paperWorkTableRows.map((row) => (
                        <tr key={row.riderId}>
                          <td><strong>{row.name}</strong></td>
                          <td>{row.delivered}</td>
                          <td>{money(row.online)}</td>
                          <td>{money(row.bill)}</td>
                          <td>{money(row.charge)}</td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={row.salary}
                              onChange={(e) => handleUpdateSalary(row.riderId, e.target.value)}
                              style={{ width: "100px", padding: "5px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                            />
                          </td>
                          <td>{money(row.fine)}</td>
                        </tr>
                      ))}
                      {paperWorkTableRows.length === 0 && (
                        <tr>
                          <td colSpan={7} className="empty-cell">Please select at least one rider to view paper work metrics.</td>
                        </tr>
                      )}
                    </tbody>
                    {paperWorkTableRows.length > 0 && (
                      <tfoot>
                        <tr>
                          <th>All Total</th>
                          <th>{paperWorkTotals.delivered}</th>
                          <th>{money(paperWorkTotals.online)}</th>
                          <th>{money(paperWorkTotals.bill)}</th>
                          <th>{money(paperWorkTotals.charge)}</th>
                          <th>{money(paperWorkTotals.salary)}</th>
                          <th>{money(paperWorkTotals.fine)}</th>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>

              {/* Profit Calculation Section */}
              <div className="panel" style={{ textAlign: "center", padding: "30px", background: "linear-gradient(135deg, #f0fdf4 0%, #e6f6ef 100%)", border: "1px solid #bbf7d0" }}>
                <div style={{ fontSize: "14px", fontWeight: "700", color: "#15803d", letterSpacing: "1.5px" }}>PROFIT SUMMARY</div>
                <div style={{ fontSize: "13px", color: "#64748b", margin: "5px 0 15px" }}>Date: {paperWorkDate}</div>
                <div style={{ fontSize: "36px", fontWeight: "800", color: "#166534", margin: "10px 0" }}>
                  {money(calculatedProfit)}
                </div>
                <div style={{ fontSize: "12px", color: "#475569" }}>
                  Formula: (Total Bill × 9.4%) + Total Charge = ({money(paperWorkTotals.bill)} × 9.4%) + {money(paperWorkTotals.charge)}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Dedicated Bulk Restaurant Management Page */}
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
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                      />
                      <span>{res.name || res.id}</span>
                      <small className="cell-sub">Status: {res.open || "N/A"} | Priority: {res.priority ?? "N/A"}</small>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {page === "restaurants" && (
          <section className="content">
            <div className="section-heading"><div><h2>Restaurant accounts</h2><p>Restaurant-based sales and physical cash ledger</p></div></div>
            <div className="filter-bar">
              <label>Restaurant<select value={restaurantId} onChange={(e) => setRestaurantId(e.target.value)}>{restaurants.map((r) => <option key={r.id} value={r.id}>{r.name || r.id}</option>)}</select></label>
              <label>Account date<input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} /></label>
            </div>
            <div className="stats-grid">
              <StatCard label="Restaurant item sales" value={money(restaurantSales)} hint="Selected date · delivered items" icon="৳" tone="green" />
              <StatCard label="Physical amount" value={money(restaurantPhysicalTotal)} hint={`Physical entry total · ${selectedDate}`} icon="▣" tone="blue" />
              <StatCard label="Matching orders" value={restaurantOrders.length} hint="Orders containing this restaurant's items" icon="▤" tone="purple" />
            </div>
            <div className="panel">
              <div className="panel-head"><div><h3>Restaurant order list</h3><p>Item subtotal excluding delivery and service charges</p></div></div>
              <RestaurantOrderTable orders={restaurantOrders} />
            </div>
            <div className="panel">
              <div className="panel-head"><div><h3>Physical account entry</h3><p>Cash ledger entries for restaurant</p></div></div>
              <EntryForm amount={entryAmount} setAmount={setEntryAmount} note={entryNote} setNote={setEntryNote} onSubmit={saveManagementEntry} saving={saving} submitLabel="Save / Replace physical entry" />
              <EntryTable entries={managementEntries.filter((e) => e.entityType === "restaurant" && String(e.entityId) === String(restaurantId) && dateKey(e.date || e.createdAt) === selectedDate)} onDelete={(id) => removeEntry(COLLECTIONS.management, id)} />
            </div>
          </section>
        )}

        {page === "riders" && (
          <section className="content">
            <div className="section-heading"><div><h2>Rider accounts</h2><p>COD collection, fine and daily salary tracking</p></div></div>
            <div className="filter-bar">
              <label>Rider<select value={riderId} onChange={(e) => setRiderId(e.target.value)}>{riders.map((r) => <option key={r.id} value={r.id}>{r.name || r.id}</option>)}</select></label>
              <label>Account date<input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} /></label>
            </div>
            <div className="stats-grid">
              <StatCard label="Collection" value={money(riderCollectionTotal)} hint={`Selected date · ${selectedDate}`} icon="৳" tone="blue" />
              <StatCard label="Fine" value={money(riderFineTotal)} hint="Selected date total" icon="!" tone="red" />
              <StatCard label="Salary" value={money(riderSalaryTotal)} hint="Selected date total" icon="＋" tone="orange" />
              <StatCard label="Delivered COD handled" value={money(riderCOD)} hint={`${riderOrders.length} delivered orders`} icon="✓" tone="green" />
            </div>
            <div className="panel">
              <div className="panel-head"><div><h3>Daily account entry</h3><p>Record collection, fine and salary separately</p></div></div>
              <form className="entry-form rider-entry-form" onSubmit={saveManagementEntry}>
                <label>Total collection (৳)<input type="number" min="0" step="0.01" value={riderCollectionAmount} onChange={(e) => setRiderCollectionAmount(e.target.value)} placeholder="Collection amount" /></label>
                <label>Fine (৳)<input type="number" min="0" step="0.01" value={riderFineAmount} onChange={(e) => setRiderFineAmount(e.target.value)} placeholder="Fine amount" /></label>
                <label>Today salary (৳)<input type="number" min="0" step="0.01" value={riderSalaryAmount} onChange={(e) => setRiderSalaryAmount(e.target.value)} placeholder="Salary amount" /></label>
                <label className="note-field">Note<input value={entryNote} onChange={(e) => setEntryNote(e.target.value)} placeholder="Add a note (optional)" /></label>
                <button className="primary-btn" disabled={saving}>{saving ? "Saving…" : "Save / Replace entries"}</button>
              </form>
              <EntryTable entries={managementEntries.filter((entry) => entry.entityType === "rider" && String(entry.entityId) === String(riderId) && dateKey(entry.date || entry.createdAt) === selectedDate)} onDelete={(id) => removeEntry(COLLECTIONS.management, id)} />
            </div>
            <div className="panel"><div className="panel-head"><div><h3>Rider delivered orders</h3><p>Selected date · delivered only</p></div></div><OrderTable orders={riderOrders} /></div>
          </section>
        )}

        {page === "online" && (
          <section className="content">
            <div className="section-heading"><div><h2>Online accounts</h2><p>bKash and Nagad transaction ledger</p></div></div>
            <div className="stats-grid">
              <StatCard label="Total bKash" value={money(bKashTotal)} hint="All saved entries" icon="B" tone="pink" />
              <StatCard label="Total Nagad" value={money(nagadTotal)} hint="All saved entries" icon="N" tone="orange" />
              <StatCard label="Grand total" value={money(bKashTotal + nagadTotal)} hint="bKash + Nagad" icon="৳" tone="green" />
            </div>
            <div className="panel">
              <div className="tabs"><button className={onlineMethod === "bKash" ? "selected" : ""} onClick={() => setOnlineMethod("bKash")}>bKash</button><button className={onlineMethod === "Nagad" ? "selected" : ""} onClick={() => setOnlineMethod("Nagad")}>Nagad</button></div>
              <div className="filter-bar compact"><label>Entry date<input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} /></label></div>
              <form className="entry-form" onSubmit={saveOnlineEntry}>
                <label>Amount (৳)<input type="number" min="0" step="0.01" value={onlineAmount} onChange={(e) => setOnlineAmount(e.target.value)} placeholder="0.00" required /></label>
                <label className="note-field">Note<input value={onlineNote} onChange={(e) => setOnlineNote(e.target.value)} placeholder="Optional transaction note" /></label>
                <button className="primary-btn" disabled={saving}>{saving ? "Saving…" : `Add ${onlineMethod} entry`}</button>
              </form>
              <div className="panel-head list-heading"><div><h3>{onlineMethod} entries</h3><p>{selectedDate}</p></div><span className="count-pill">{filteredOnline.length} entries</span></div>
              <EntryTable entries={filteredOnline} onDelete={(id) => removeEntry(COLLECTIONS.online, id)} showMethod />
            </div>
          </section>
        )}

        {page === "history" && (
          <section className="content">
            <div className="section-heading"><div><h2>History & reports</h2><p>Date range-based consolidated accounts report</p></div></div>
            <div className="filter-bar">
              <label>Account type<select value={historyType} onChange={(e) => setHistoryType(e.target.value)}><option value="restaurant">Restaurant</option><option value="rider">Rider</option><option value="online">Online</option></select></label>
              {historyType === "restaurant" && <label>Restaurant<select value={restaurantId} onChange={(e) => setRestaurantId(e.target.value)}>{restaurants.map((r) => <option key={r.id} value={r.id}>{r.name || r.id}</option>)}</select></label>}
              {historyType === "rider" && <label>Rider<select value={riderId} onChange={(e) => setRiderId(e.target.value)}>{riders.map((r) => <option key={r.id} value={r.id}>{r.name || r.id}</option>)}</select></label>}
              <label>Start date<input type="date" value={historyStart} onChange={(e) => setHistoryStart(e.target.value)} /></label>
              <label>End date<input type="date" value={historyEnd} min={historyStart} onChange={(e) => setHistoryEnd(e.target.value)} /></label>
            </div>
            <div className="panel">
              <div className="panel-head"><div><h3>Date-wise summary</h3><p>Selected period totals</p></div><span className="count-pill">{historyRows.length} days</span></div>
              <div className="table-wrap"><table><thead><tr><th>Date</th>{historyType === "restaurant" && <th>Item sales</th>}{historyType !== "online" && <><th>Collection</th>{historyType === "rider" && <th>COD amount</th>}<th>Fine</th><th>Salary</th></>}{historyType === "online" && <><th>bKash</th><th>Nagad</th></>}</tr></thead><tbody>{historyRows.map((row) => <tr key={row.date}><td>{row.date}</td>{historyType === "restaurant" && <td>{money(row.sales)}</td>}{historyType !== "online" && <><td>{money(row.collection)}</td>{historyType === "rider" && <td>{money(row.cod)}</td>}<td>{money(row.fine)}</td><td>{money(row.salary)}</td></>}{historyType === "online" && <><td>{money(row.bkash)}</td><td>{money(row.nagad)}</td></>}</tr>)}{!historyRows.length && <EmptyRow colSpan={historyType === "online" ? 3 : historyType === "restaurant" ? 5 : 4} />}</tbody>{historyRows.length > 0 && <tfoot><tr><th>Grand total</th>{historyType === "restaurant" && <th>{money(historyTotals.sales)}</th>}{historyType !== "online" && <><th>{money(historyTotals.collection)}</th>{historyType === "rider" && <th>{money(historyTotals.cod)}</th>}<th>{money(historyTotals.fine)}</th><th>{money(historyTotals.salary)}</th></>}{historyType === "online" && <><th>{money(historyTotals.bkash)}</th><th>{money(historyTotals.nagad)}</th></>}</tr></tfoot>}</table></div>
            </div>
            <div className="panel"><div className="panel-head"><div><h3>Saved entries</h3><p>Ledger records for selected date range</p></div></div><EntryTable entries={historySavedEntries} onDelete={(id) => removeEntry(historyType === "online" ? COLLECTIONS.online : COLLECTIONS.management, id)} showMethod={historyType === "online"} /></div>
          </section>
        )}

        <footer className="footer print-hide">CityFood Accounts · Firebase Firestore · Built for internal operations</footer>
      </main>
      {notice && <div className={`toast ${notice.type}`}><span>{notice.type === "success" ? "✓" : "!"}</span>{notice.text}</div>}
      {saving && <div className="saving-overlay"><div className="loader" /><strong>Saving your entry…</strong></div>}
    </div>
  );
}

function StatCard({ label, value, hint, icon, tone }) {
  return <div className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-hint">{hint}</div></div>;
}

function EmptyRow({ colSpan = 6 }) {
  return <tr><td colSpan={colSpan} className="empty-cell">No records found for this selection.</td></tr>;
}

function OrderTable({ orders }) {
  return <div className="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Time</th><th>Payment</th><th>Status</th><th className="right">Total</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td><strong>#{order.id.slice(0, 8)}</strong></td><td>{order.userName || "—"}<small className="cell-sub">{order.userPhone || ""}</small></td><td>{formatDateTime(order.createdAt)}</td><td>{order.payment || "—"}</td><td><span className={`status ${isDelivered(order) ? "good" : isCancelled(order) ? "bad" : "pending"}`}>{order.orderStatus || "Pending"}</span></td><td className="right">{money(orderAmount(order))}</td></tr>)}{!orders.length && <EmptyRow />}</tbody></table></div>;
}

function RestaurantOrderTable({ orders }) {
  return <div className="table-wrap"><table><thead><tr><th>Order ID</th><th>Customer</th><th>Time</th><th>Payment</th><th>Status</th><th className="right">Item subtotal</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td><strong>#{order.id.slice(0, 8)}</strong></td><td>{order.userName || "—"}</td><td>{formatDateTime(order.createdAt)}</td><td>{order.payment || "—"}</td><td><span className={`status ${isDelivered(order) ? "good" : isCancelled(order) ? "bad" : "pending"}`}>{order.orderStatus || "Pending"}</span></td><td className="right">{money(order.restaurantSubtotal)}</td></tr>)}{!orders.length && <EmptyRow />}</tbody></table></div>;
}

function EntryForm({ amount, setAmount, note, setNote, onSubmit, saving, submitLabel }) {
  return <form className="entry-form" onSubmit={onSubmit}><label>Amount (৳)<input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" required /></label><label className="note-field">Note<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional details" /></label><button className="primary-btn" disabled={saving}>{saving ? "Saving…" : submitLabel}</button></form>;
}

function EntryTable({ entries, onDelete, showMethod = false }) {
  const sorted = [...entries].sort((a, b) => (asDate(b.createdAt)?.getTime() || 0) - (asDate(a.createdAt)?.getTime() || 0));
  return <div className="table-wrap"><table><thead><tr><th>Date / Time</th>{showMethod && <th>Method</th>}<th>Account / Type</th><th>Note</th><th className="right">Amount</th><th /></tr></thead><tbody>{sorted.map((entry) => <tr key={entry.id}><td>{formatDateTime(entry.createdAt || entry.date)}</td>{showMethod && <td>{entry.method || "—"}</td>}<td>{entry.entityName || entry.type || "—"}</td><td className="note-cell">{entry.note || "—"}</td><td className="right">{money(entry.amount)}</td><td>{!entry.readOnly && <button className="delete-btn" title="Delete entry" onClick={() => onDelete(entry.id)}>Delete</button>}</td></tr>)}{!sorted.length && <EmptyRow colSpan={showMethod ? 6 : 5} />}</tbody></table></div>;
}

const styles = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap');
:root{font-family:'DM Sans',sans-serif;color:#172033;background:#f5f7fb;font-synthesis:none}
*{box-sizing:border-box}body{margin:0}.app-shell{min-height:100vh;display:flex;background:#f5f7fb}.sidebar{width:250px;background:#111b2e;color:#d5deed;min-height:100vh;padding:27px 17px;display:flex;flex-direction:column;position:fixed;inset:0 auto 0 0;z-index:5}.brand{display:flex;align-items:center;gap:11px;padding:0 10px 37px}.brand-mark{width:39px;height:39px;border-radius:13px;background:linear-gradient(145deg,#35c98b,#16a875);display:grid;place-items:center;color:white;font-weight:800;font-size:22px}.brand strong{display:block;color:#fff;font:800 18px 'Plus Jakarta Sans'}.brand small{display:block;color:#8190a8;font-size:9px;letter-spacing:1.4px;margin-top:3px}.side-label,.eyebrow{font-size:10px;font-weight:700;letter-spacing:1.5px;color:#8290a8}.side-label{padding:0 12px 12px}.sidebar nav{display:grid;gap:6px}.nav-link{border:0;background:transparent;color:#aab6c9;text-align:left;padding:12px;border-radius:10px;display:flex;align-items:center;gap:12px;font:600 13px 'DM Sans';cursor:pointer}.nav-link:hover{background:#1b2941;color:#fff}.nav-link.active{background:#203b3d;color:#6de0ad}.nav-icon{width:22px;text-align:center;font-size:18px}.sidebar-bottom{margin-top:auto;border-top:1px solid #26334a;padding:18px 10px 0;font-size:11px;color:#aab6c9}.sidebar-bottom small{display:block;color:#74839b;margin:7px 0 0 15px;font-size:10px}.online-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#35cf8b;margin-right:7px}.main-area{margin-left:250px;width:calc(100% - 250px);min-width:0}.topbar{height:91px;background:#fff;border-bottom:1px solid #e9edf4;display:flex;align-items:center;justify-content:space-between;padding:0 36px;position:sticky;top:0;z-index:4}.topbar h1{font:800 21px 'Plus Jakarta Sans';margin:5px 0 0;color:#18243a}.eyebrow{color:#93a0b3;font-size:9px}.topbar-right{display:flex;align-items:center;gap:17px}.today-chip{font-size:11px;color:#64748b;background:#f2f8f5;padding:8px 12px;border-radius:20px}.today-chip span{color:#20b879;margin-right:5px}.avatar{width:34px;height:34px;background:#e6f6ef;color:#149966;border-radius:50%;display:grid;place-items:center;font-weight:800}.content{max-width:1440px;margin:0 auto;padding:30px 36px 18px}.section-heading{display:flex;justify-content:space-between;align-items:end;margin:0 0 22px}.section-heading h2{font:800 20px 'Plus Jakarta Sans';margin:0 0 5px}.section-heading p,.panel-head p{font-size:12px;color:#8a96a8;margin:0}.date-label{font-size:11px;color:#7c899d}.stats-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:15px;margin-bottom:20px}.stats-grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}.stat-card{background:#fff;border:1px solid #e9edf4;border-radius:14px;padding:18px;min-width:0;box-shadow:0 2px 7px #14213b05}.stat-icon{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;font-weight:800;font-size:16px;margin-bottom:13px}.stat-icon.green{background:#e7f8f0;color:#17a66d}.stat-icon.red{background:#fff0ef;color:#e25b56}.stat-icon.blue{background:#eaf2ff;color:#4c7de1}.stat-icon.purple{background:#f2edff;color:#8a69d5}.stat-icon.pink{background:#fff0f6;color:#d94e93}.stat-icon.orange{background:#fff3e8;color:#d98835}.stat-label{font-size:11px;color:#8290a3;font-weight:600}.stat-value{font:800 23px 'Plus Jakarta Sans';color:#17243b;margin:5px 0}.stat-hint{font-size:10px;color:#9aa5b5}.panel{background:#fff;border:1px solid #e8edf4;border-radius:14px;margin-bottom:19px;padding:20px;box-shadow:0 2px 7px #14213b05;min-width:0}.panel-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:17px}.panel-head h3{font:700 14px 'Plus Jakarta Sans';margin:0 0 5px}.count-pill{font-size:10px;background:#f1f5f9;color:#66758b;padding:6px 10px;border-radius:20px}.filter-bar{display:flex;align-items:end;gap:14px;flex-wrap:wrap;background:#fff;border:1px solid #e8edf4;border-radius:13px;padding:15px;margin-bottom:17px}.filter-bar label,.entry-form label{display:grid;gap:7px;color:#738096;font-size:10px;font-weight:700;min-width:160px}.filter-bar select,.filter-bar input,.entry-form input,.entry-form select{height:38px;border:1px solid #e0e6ee;border-radius:8px;background:#fff;padding:0 10px;color:#25324a;font:500 12px 'DM Sans';outline:none}.filter-bar select:focus,.filter-bar input:focus,.entry-form input:focus,.entry-form select:focus{border-color:#32b982;box-shadow:0 0 0 3px #32b98218}.table-wrap{width:100%;overflow-x:auto}table{width:100%;border-collapse:collapse;white-space:nowrap;text-align:left}th{font-size:9px;text-transform:uppercase;letter-spacing:.7px;color:#9aa5b5;background:#f8fafc;padding:11px 12px;font-weight:700}td{font-size:11px;color:#526076;padding:12px;border-bottom:1px solid #f0f2f6}tbody tr:last-child td{border-bottom:0}td strong{color:#27364d;font-size:11px}.right{text-align:right}.cell-sub{display:block;font-size:9px;color:#9aa5b5;margin-top:3px}.status{display:inline-flex;padding:4px 8px;border-radius:20px;font-size:9px;font-weight:700;text-transform:capitalize}.status.good{background:#e8f8f0;color:#159b65}.status.bad{background:#fff0ef;color:#d85853}.status.pending{background:#fff7e8;color:#bb842b}.empty-cell{text-align:center;color:#9aa5b5;padding:28px}.entry-form{display:flex;align-items:end;gap:12px;flex-wrap:wrap;margin:2px 0 18px}.entry-form label{flex:1}.entry-form .note-field{flex:2;min-width:190px}.rider-entry-form label{min-width:145px}.primary-btn{height:38px;padding:0 16px;background:#17a873;border:0;border-radius:8px;color:#fff;font:700 11px 'DM Sans';cursor:pointer;white-space:nowrap}.primary-btn:hover{background:#108d60}.primary-btn:disabled{opacity:.6;cursor:wait}.delete-btn{border:0;background:#fff1f0;color:#d35b54;border-radius:6px;padding:6px 8px;font-size:9px;font-weight:700;cursor:pointer}.tabs{display:flex;gap:6px;border-bottom:1px solid #edf0f5;margin:-2px 0 15px}.tabs button{background:none;border:0;padding:10px 17px;color:#8995a6;font:700 12px 'DM Sans';cursor:pointer;border-bottom:2px solid transparent}.tabs button.selected{color:#159b68;border-color:#20b77a}.compact{border:0;padding:0;margin:0 0 15px}.list-heading{margin-top:20px}.footer{text-align:center;color:#a4adbb;font-size:10px;padding:14px 20px 24px}.loading-line{height:3px;background:#e7f5ee;color:#258d65;font-size:10px;padding-left:36px}.loading-line span{display:block;height:3px;width:35%;background:#22b77b;animation:load 1.5s infinite}@keyframes load{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}.alert{margin:18px 36px 0;padding:12px 14px;border-radius:9px;font-size:11px}.error-alert{background:#fff0ef;color:#b94c47}.toast{position:fixed;right:24px;bottom:24px;z-index:20;background:#14243a;color:white;border-radius:10px;padding:13px 17px;box-shadow:0 12px 35px #14213b30;font-size:12px;display:flex;gap:9px;align-items:center;max-width:min(440px,calc(100vw - 32px));animation:pop .2s ease}.toast.success span{color:#56dfa1}.toast.error span{color:#ff8880}@keyframes pop{from{transform:translateY(10px);opacity:0}to{transform:translateY(0);opacity:1}}.saving-overlay{position:fixed;inset:0;background:#0e1a2b70;z-index:30;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;gap:12px;font-size:12px}.loader{width:31px;height:31px;border:3px solid #d9eee5;border-top-color:#18a873;border-radius:50%;animation:spin .7s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.boot-screen{min-height:100vh;display:grid;place-content:center;justify-items:center;gap:12px;background:#f5f7fb;color:#66758b;font:12px 'DM Sans'}.error-panel{max-width:480px;background:#fff;padding:25px;border:1px solid #f1cecb;border-radius:12px;color:#a74440}.error-panel h2{font-size:17px}.error-panel p{font-size:12px;line-height:1.6}
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

/* Bulk management extra styles */
.bulk-action-panel { background: #fafbfc; border: 1px solid #e1e7ef; }
.bulk-actions-btns { display: flex; gap: 10px; flex-wrap: wrap; }
.on-btn { background: #17a873; }
.off-btn { background: #e25b56; }
.off-btn:hover { background: #c54843; }
.selection-controls { display: flex; align-items: center; gap: 12px; margin-bottom: 15px; }
.text-btn { background: none; border: 0; color: #18a873; font-weight: 700; font-size: 12px; cursor: pointer; padding: 0; }
.text-btn:hover { text-decoration: underline; }
.multi-select-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; max-height: 250px; overflow-y: auto; padding: 4px; border: 1px solid #e9edf4; border-radius: 8px; background: #fff; }
.restaurant-checkbox-card { display: flex; flex-direction: column; gap: 3px; padding: 10px; border: 1px solid #e2e8f0; border-radius: 8px; cursor: pointer; background: #fdfdfd; transition: all 0.15s ease; }
.restaurant-checkbox-card:hover { border-color: #cbd5e1; background: #f8fafc; }
.restaurant-checkbox-card.selected { border-color: #17a873; background: #f0fdf4; box-shadow: 0 0 0 1px #17a873; }
.restaurant-checkbox-card span { font-weight: 700; font-size: 13px; color: #1e293b; }

/* Print Styles: Hide UI controls when printing/downloading */
@media print {
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
    margin-bottom: 20px !important;
  }
  .print-only-header {
    display: block !important;
  }
}

@media(max-width:520px){.login-page{padding:22px 14px 58px}.login-card{padding:37px 24px 29px;border-radius:20px}.login-card h1{font-size:24px}.login-brand-name{font-size:23px}.login-description{font-size:12px}}
@media(max-width:1000px){.sidebar{width:210px}.main-area{margin-left:210px;width:calc(100% - 210px)}.content{padding:24px}.topbar{padding:0 24px}.stats-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:680px){.sidebar{width:270px;max-width:82vw;padding:22px 17px;transform:translateX(-105%);transition:transform .32s cubic-bezier(.2,.8,.2,1);box-shadow:18px 0 50px #101b2e24}.sidebar.sidebar-open{transform:translateX(0)}.brand{padding:0 8px 30px}.brand>div:last-child,.side-label,.nav-link span:last-child,.sidebar-bottom{display:block}.nav-link{justify-content:flex-start;padding:14px 12px;min-height:46px}.main-area{margin-left:0;width:100%}.topbar{height:72px;padding:0 14px 0 58px;position:sticky}.mobile-menu-btn{display:grid;place-items:center;position:absolute;left:13px;top:18px;width:34px;height:34px;border:1px solid #e7edf2;border-radius:9px;background:#fff;color:#26364b;font-size:18px;cursor:pointer}.sidebar-scrim{display:block;position:fixed;inset:0;background:#0d1728a6;border:0;z-index:4;backdrop-filter:blur(2px)}.topbar h1{font-size:18px}.content{padding:20px 14px 30px}.section-heading{align-items:start;gap:10px;flex-direction:column}.section-heading h2{font-size:19px}.stats-grid,.stats-grid.two{grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}.stat-card{padding:15px;min-height:130px;border-radius:15px}.stat-icon{width:38px;height:38px}.stat-value{font-size:clamp(18px,5vw,23px)}.stat-label{font-size:11px}.stat-hint{font-size:10px;line-height:1.45}.panel{padding:15px;border-radius:14px}.filter-bar{padding:13px;gap:12px}.filter-bar label{flex:1 1 100%;min-width:0;font-size:11px}.filter-bar select,.filter-bar input,.entry-form input,.entry-form select{height:44px;font-size:14px}.entry-form{display:grid;grid-template-columns:1fr;gap:13px}.entry-form label,.entry-form .note-field{min-width:0}.entry-form label{font-size:11px}.entry-form .primary-btn{width:100%;height:46px;font-size:13px}.primary-btn,.delete-btn{min-height:40px}.table-wrap{border-radius:9px}th{font-size:10px;padding:13px 12px}td{font-size:12px;padding:14px 12px}.date-label{font-size:11px}.alert{margin:12px 13px 0}.today-chip{font-size:10px;padding:8px}.avatar{width:34px;height:34px}.footer{padding-bottom:30px}}
@media(min-width:681px){.mobile-menu-btn,.sidebar-scrim{distance:none}}
@media(max-width:380px){.stats-grid,.stats-grid.two{grid-template-columns:1fr}.stat-card{min-height:unset}.topbar-right{gap:8px}.today-chip{display:none}}
`;

export default App;