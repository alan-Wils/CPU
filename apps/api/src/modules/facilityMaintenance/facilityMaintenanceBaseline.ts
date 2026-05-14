/** Frozen mockup content for first-time company seed (prompt + image spec). */

export const BASELINE_SEEDED_WORK_ORDER_COUNT = 5;

export const BASELINE_ROOM_COUNTS = {
  cultivationRooms: 8,
  flowerRooms: 6,
  dryingRooms: 2,
  processingRooms: 2,
  extractionLabs: 1,
  packagingRooms: 1,
  retailAreas: 1,
  warehouses: 1,
};

export const BASELINE_KPI_SNAPSHOT = {
  kpi: {
    totalWorkOrders: 248,
    totalWorkOrdersChange: "↑ 18.6%",
    totalWorkOrdersSub: "vs last 30 days",
    completed: 156,
    completedChange: "↑ 22.4%",
    completedSub: "vs last 30 days",
    inProgress: 54,
    inProgressChange: "↑ 6.8%",
    inProgressSub: "vs last 30 days",
    overdue: 38,
    overdueChange: "↓ 12.2%",
    overdueSub: "vs last 30 days",
    pmCompliancePct: 92,
    pmComplianceChange: "↑ 7.1%",
    pmComplianceSub: "vs last 30 days",
    totalCostMtd: 18420,
    totalCostChange: "↓ 5.3%",
    totalCostSub: "vs last month",
  },
  statusChart: [
    { label: "Completed", value: 156, pct: "62.9%" },
    { label: "In Progress", value: 54, pct: "21.8%" },
    { label: "Overdue", value: 38, pct: "15.3%" },
    { label: "Scheduled", value: 28, pct: "11.3%" },
    { label: "On Hold", value: 12, pct: "4.8%" },
  ],
  statusChartCenterTotal: 248,
  priorityChart: [
    { label: "High", value: 54 },
    { label: "Medium", value: 112 },
    { label: "Low", value: 62 },
    { label: "None", value: 20 },
  ],
  maintenanceCostSubtext: "↓ 5.3% vs last month",
};

/** MTD cost line — normalized trend ending at mockup total (not extra business facts). */
export const BASELINE_MTD_COST_SERIES = [
  { day: 1, amount: 20100 },
  { day: 3, amount: 19820 },
  { day: 5, amount: 19650 },
  { day: 7, amount: 19400 },
  { day: 9, amount: 19280 },
  { day: 11, amount: 19100 },
  { day: 13, amount: 18950 },
  { day: 15, amount: 18820 },
  { day: 17, amount: 18700 },
  { day: 19, amount: 18620 },
  { day: 21, amount: 18540 },
  { day: 23, amount: 18490 },
  { day: 25, amount: 18460 },
  { day: 27, amount: 18420 },
];

export const BASELINE_WORK_ORDERS = [
  {
    externalId: "WO-10248",
    title: "HVAC not cooling in Flower Room 2",
    location: "Flower Room 2",
    category: "HVAC",
    priority: "High",
    status: "In Progress",
    assignedTo: "Mike Johnson",
    dueDate: "2025-05-15T16:00:00.000Z",
    dueMeta: "2 days left",
    sortOrder: 0,
  },
  {
    externalId: "WO-10247",
    title: "Drip irrigation leak in Veg Room 1",
    location: "Veg Room 1",
    category: "Irrigation",
    priority: "Medium",
    status: "In Progress",
    assignedTo: "Sarah Williams",
    dueDate: "2025-05-16T16:00:00.000Z",
    dueMeta: "3 days left",
    sortOrder: 1,
  },
  {
    externalId: "WO-10246",
    title: "Dehumidifier filter replacement",
    location: "Drying Room 1",
    category: "HVAC",
    priority: "Low",
    status: "Scheduled",
    assignedTo: "David Brown",
    dueDate: "2025-05-18T16:00:00.000Z",
    dueMeta: "",
    sortOrder: 2,
  },
  {
    externalId: "WO-10245",
    title: "CO₂ sensor calibration",
    location: "Flower Room 3",
    category: "Environmental",
    priority: "Medium",
    status: "In Progress",
    assignedTo: "Emily Davis",
    dueDate: "2025-05-14T16:00:00.000Z",
    dueMeta: "1 day left",
    sortOrder: 3,
  },
  {
    externalId: "WO-10244",
    title: "Packaging machine preventive maintenance",
    location: "Packaging Room",
    category: "Equipment",
    priority: "High",
    status: "Overdue",
    assignedTo: "Mike Johnson",
    dueDate: "2025-05-12T16:00:00.000Z",
    dueMeta: "2 days overdue",
    sortOrder: 4,
  },
];

export const BASELINE_ALERTS = [
  {
    title: "High Temperature Alert",
    locationLabel: "Flower Room 2",
    valueLabel: "72.4°F",
    statusLabel: null,
    timeLabel: "2 min ago",
    sortOrder: 0,
  },
  {
    title: "Humidity Out of Range",
    locationLabel: "Veg Room 1",
    valueLabel: "32%",
    statusLabel: null,
    timeLabel: "8 min ago",
    sortOrder: 1,
  },
  {
    title: "CO₂ Level High",
    locationLabel: "Flower Room 5",
    valueLabel: "1,450 ppm",
    statusLabel: null,
    timeLabel: "10 min ago",
    sortOrder: 2,
  },
  {
    title: "Filter Replacement Due",
    locationLabel: "HVAC Unit AHU-2",
    valueLabel: null,
    statusLabel: "Due today",
    timeLabel: "1 hr ago",
    sortOrder: 3,
  },
  {
    title: "PM Overdue",
    locationLabel: "Irrigation System",
    valueLabel: null,
    statusLabel: "3 days overdue",
    timeLabel: "2 hrs ago",
    sortOrder: 4,
  },
];

export const BASELINE_SYSTEMS = [
  { name: "HVAC", status: "Normal", sortOrder: 0 },
  { name: "Environmental Control", status: "Normal", sortOrder: 1 },
  { name: "Water System", status: "Normal", sortOrder: 2 },
  { name: "Electrical", status: "Normal", sortOrder: 3 },
  { name: "Security System", status: "Normal", sortOrder: 4 },
  { name: "Fire Suppression", status: "Normal", sortOrder: 5 },
];

export const BASELINE_ENVIRONMENT = [
  {
    metricKey: "temperature",
    label: "Temperature",
    valueDisplay: "72.4°F",
    idealRangeDisplay: "70-78°F",
    sparklineJson: [70.8, 71.2, 71.9, 72.1, 72.4],
    statusLabel: "Ideal",
    sortOrder: 0,
  },
  {
    metricKey: "humidity",
    label: "Humidity",
    valueDisplay: "54%",
    idealRangeDisplay: "45-55%",
    sparklineJson: [48, 50, 52, 53, 54],
    statusLabel: "Ideal",
    sortOrder: 1,
  },
  {
    metricKey: "co2",
    label: "CO₂ Level",
    valueDisplay: "820 ppm",
    idealRangeDisplay: "800-1200",
    sparklineJson: [780, 800, 810, 815, 820],
    statusLabel: "Ideal",
    sortOrder: 2,
  },
  {
    metricKey: "vpd",
    label: "VPD",
    valueDisplay: "1.2 kPa",
    idealRangeDisplay: "0.8-1.6 kPa",
    sparklineJson: [1.0, 1.05, 1.1, 1.15, 1.2],
    statusLabel: "Ideal",
    sortOrder: 3,
  },
  {
    metricKey: "light",
    label: "Light Levels",
    valueDisplay: "850 PPFD",
    idealRangeDisplay: "600-1000",
    sparklineJson: [720, 760, 800, 820, 850],
    statusLabel: "Ideal",
    sortOrder: 4,
  },
];

/** May 2025 — deterministic placement; legend counts PM=8, Inspections=5, Due Today=3, Overdue=4. */
export const BASELINE_CALENDAR_2025_05: { day: number; kind: string }[] = [
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((day) => ({ day, kind: "PM_SCHEDULED" })),
  ...[9, 10, 11, 12, 13].map((day) => ({ day, kind: "INSPECTION" })),
  ...[14, 15, 16].map((day) => ({ day, kind: "DUE_TODAY" })),
  ...[25, 26, 27, 28].map((day) => ({ day, kind: "OVERDUE" })),
];

export const CALENDAR_MONTH_LABEL = "May 2025";
export const CALENDAR_YEAR_MONTH = "2025-05";
