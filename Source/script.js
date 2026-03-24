/*
Main architecture:
1. Static definitions describe coins, GPUs, machine models, and facility tiers.
2. `state` stores the full saveable game state, including market prices, machines, inventory, offers, logs, and timestamps.
3. Repeating loops handle mining, market movement, power billing, used-market refresh, rendering, and autosave.
4. Helpers keep state transitions centralized so buying, failures, repairs, offline progress, and save/load remain easy to extend.

Versioning:
- Current version starts at 1.9.1.
- Increment the patch/build number for minor tweaks and fixes.
- Increment the minor version number for new features.
*/

const SAVE_KEY = "hash-and-crash-save-v1";
const APP_VERSION = "1.9.1";
const GAME_TICK_MS = 1000;
const MARKET_TICK_MS = 10000;
const POWER_TICK_MS = 30000;
const USED_MARKET_TICK_MS = 45000;
const AUTOSAVE_MS = 15000;
const OFFLINE_CAP_MS = 4 * 60 * 60 * 1000;
const LOG_LIMIT = 80;
const PERFORMANCE_HISTORY_MS = 5000;
const PERFORMANCE_HISTORY_LIMIT = 48;

const COIN_DEFS = {
  dogeish: { key: "dogeish", name: "Dogeish", currentPrice: 1.2, volatility: 0.09, trend: 0.004, baseYield: 0.14, unlockRequirement: { type: "earnings", value: 0 }, minimumPrice: 0.24, description: "The market insists it has fundamentals. The fundamentals are vibes." },
  shibish: { key: "shibish", name: "Shibish", currentPrice: 2.6, volatility: 0.12, trend: 0.002, baseYield: 0.09, unlockRequirement: { type: "earnings", value: 500 }, minimumPrice: 0.4, description: "Tiny bark, medium gas fees." },
  rugrune: { key: "rugrune", name: "RugRune", currentPrice: 8.4, volatility: 0.17, trend: -0.001, baseYield: 0.045, unlockRequirement: { type: "hashrate", value: 80 }, minimumPrice: 1.15, description: "Backed by immutable promises and one suspicious wizard." },
  moonbean: { key: "moonbean", name: "MoonBean", currentPrice: 18, volatility: 0.15, trend: 0.006, baseYield: 0.023, unlockRequirement: { type: "earnings", value: 10000 }, minimumPrice: 2.4, description: "Coffee-chain tokenomics for people who hate coffee." },
  pepefuel: { key: "pepefuel", name: "PepeFuel", currentPrice: 42, volatility: 0.2, trend: 0.004, baseYield: 0.012, unlockRequirement: { type: "hashrate", value: 260 }, minimumPrice: 5, description: "Volatility in liquid form." },
  hashdaddy: { key: "hashdaddy", name: "HashDaddy", currentPrice: 110, volatility: 0.24, trend: 0.008, baseYield: 0.006, unlockRequirement: { type: "earnings", value: 150000 }, minimumPrice: 12, description: "Institutional-grade nonsense." }
};

const GPU_DEFS = {
  pixelblazer960: { key: "pixelblazer960", name: "PixelBlazer 960", hashrate: 14, powerDraw: 105, price: 180, durability: 100, efficiencyModifier: 1, failureRiskModifier: 1 },
  frameforge2060: { key: "frameforge2060", name: "FrameForge 2060", hashrate: 34, powerDraw: 180, price: 620, durability: 110, efficiencyModifier: 1.05, failureRiskModifier: 0.95 },
  renderrerx3080: { key: "renderrerx3080", name: "RenderRex 3080", hashrate: 78, powerDraw: 305, price: 2100, durability: 120, efficiencyModifier: 1.12, failureRiskModifier: 0.88 },
  hashhammerx: { key: "hashhammerx", name: "HashHammer X", hashrate: 148, powerDraw: 520, price: 6800, durability: 135, efficiencyModifier: 1.22, failureRiskModifier: 0.82 },
  moonmelt9000: { key: "moonmelt9000", name: "MoonMelt 9000", hashrate: 260, powerDraw: 930, price: 19500, durability: 145, efficiencyModifier: 1.35, failureRiskModifier: 0.78 }
};

const COMPONENT_DEFS = {
  mainboard: {
    laneLordB450: { key: "laneLordB450", category: "mainboard", name: "LaneLord B450", price: 120, durability: 110, powerDraw: 18, efficiencyModifier: 0.98, failureRiskModifier: 1 },
    socketSultanX: { key: "socketSultanX", category: "mainboard", name: "Socket Sultan X", price: 420, durability: 125, powerDraw: 24, efficiencyModifier: 1.04, failureRiskModifier: 0.92 },
    rackWardenPro: { key: "rackWardenPro", category: "mainboard", name: "RackWarden Pro", price: 1400, durability: 150, powerDraw: 34, efficiencyModifier: 1.1, failureRiskModifier: 0.82 }
  },
  cpu: {
    threadBaron3: { key: "threadBaron3", category: "cpu", name: "ThreadBaron 3", price: 130, durability: 105, powerDraw: 55, efficiencyModifier: 0.98, failureRiskModifier: 1 },
    coreComptroller7: { key: "coreComptroller7", category: "cpu", name: "Core Comptroller 7", price: 480, durability: 120, powerDraw: 92, efficiencyModifier: 1.05, failureRiskModifier: 0.91 },
    taxRyzenUltra: { key: "taxRyzenUltra", category: "cpu", name: "TaxRyzen Ultra", price: 1600, durability: 138, powerDraw: 145, efficiencyModifier: 1.12, failureRiskModifier: 0.84 }
  },
  ram: {
    cacheStick16: { key: "cacheStick16", category: "ram", name: "CacheStick 16GB", price: 70, durability: 100, powerDraw: 12, efficiencyModifier: 0.99, failureRiskModifier: 1 },
    latencyLuxe32: { key: "latencyLuxe32", category: "ram", name: "LatencyLuxe 32GB", price: 220, durability: 118, powerDraw: 18, efficiencyModifier: 1.03, failureRiskModifier: 0.93 },
    memeECC64: { key: "memeECC64", category: "ram", name: "MemeECC 64GB", price: 760, durability: 140, powerDraw: 24, efficiencyModifier: 1.08, failureRiskModifier: 0.86 }
  },
  psu: {
    bronzeBrick550: { key: "bronzeBrick550", category: "psu", name: "BronzeBrick 550", price: 95, durability: 110, powerDraw: 8, efficiencyModifier: 0.98, failureRiskModifier: 1, wattage: 550 },
    goldGorilla850: { key: "goldGorilla850", category: "psu", name: "GoldGorilla 850", price: 240, durability: 125, powerDraw: 10, efficiencyModifier: 1.02, failureRiskModifier: 0.92, wattage: 850 },
    gridTitan1600: { key: "gridTitan1600", category: "psu", name: "GridTitan 1600", price: 780, durability: 145, powerDraw: 14, efficiencyModifier: 1.06, failureRiskModifier: 0.84, wattage: 1600 }
  }
};

const MACHINE_DEFS = {
  starterPc: { key: "starterPc", name: "Starter Gaming PC", gpuSlots: 1, maxExpansionSlots: 1, componentSlots: { mainboard: 1, cpu: 1, ram: 1, psu: 1 }, maxPsuBayCount: 0, allowedPsuBaySizes: [], expansionSlotCost: 140, baseEfficiency: 1, price: 350, basePower: 65, repairBaseCost: 50, description: "A single desktop held together by optimism." },
  midTower: { key: "midTower", name: "Mid-tier Tower", gpuSlots: 2, maxExpansionSlots: 2, componentSlots: { mainboard: 1, cpu: 1, ram: 2, psu: 1 }, maxPsuBayCount: 1, allowedPsuBaySizes: ["mini"], expansionSlotCost: 260, baseEfficiency: 1.08, price: 1400, basePower: 95, repairBaseCost: 110, description: "A respectable amount of airflow and denial." },
  rig4: { key: "rig4", name: "4-slot Mining Rig", gpuSlots: 4, maxExpansionSlots: 2, componentSlots: { mainboard: 1, cpu: 2, ram: 4, psu: 1 }, maxPsuBayCount: 2, allowedPsuBaySizes: ["mini", "dual"], expansionSlotCost: 850, baseEfficiency: 1.16, price: 5200, basePower: 180, repairBaseCost: 280, description: "Screams loudly, prints margins quietly." },
  rig8: { key: "rig8", name: "8-slot Industrial Rig", gpuSlots: 8, maxExpansionSlots: 4, componentSlots: { mainboard: 1, cpu: 2, ram: 8, psu: 1 }, maxPsuBayCount: 3, allowedPsuBaySizes: ["mini", "dual", "rack"], expansionSlotCost: 2200, baseEfficiency: 1.28, price: 16800, basePower: 360, repairBaseCost: 750, description: "Looks like a tax audit in rack form." }
};

const PSU_BAY_DEFS = {
  mini: { key: "mini", name: "Mini PSU Bay", addedSlots: 1, price: 180, description: "One extra external PSU cradle for sensible overkill." },
  dual: { key: "dual", name: "Dual PSU Bay", addedSlots: 2, price: 520, description: "Two extra PSU mounts for when one wall plug becomes a lifestyle." },
  rack: { key: "rack", name: "Rack PSU Bay", addedSlots: 3, price: 1180, description: "A proper bus-bar-adjacent bay for industrial-grade denial." }
};

const EXTERNAL_POWER_DEFS = [
  { key: "breakerBuddy2k", name: "Breaker Buddy 2k", price: 1800, capacityWatts: 1800, facilityTierRequired: 0, description: "A polite external feed that keeps the lights on a bit longer." },
  { key: "gridAnchor5k", name: "GridAnchor 5k", price: 6200, capacityWatts: 5000, facilityTierRequired: 1, description: "A more serious external supply for sites that have stopped pretending." },
  { key: "substation12k", name: "Substation 12k", price: 22800, capacityWatts: 12000, facilityTierRequired: 2, description: "Basically a small utility relationship in a box." }
];

const FACILITY_DEFS = [
  { key: "bedroom", name: "Bedroom Setup", maxMachines: 3, powerCapacity: 1000, upgradeCost: 0, earningsRequirement: 0, powerRateModifier: 1.2, solarEfficiency: 0.82, solarAllowed: true, prerequisiteFacilityKeys: [], description: "One room, one power strip, infinite heat." },
  { key: "secondBedroom", name: "Second Bedroom Fitout", maxMachines: 4, powerCapacity: 1500, upgradeCost: 2400, earningsRequirement: 1200, powerRateModifier: 1.18, solarEfficiency: 0.84, solarAllowed: true, prerequisiteFacilityKeys: ["bedroom"], description: "More floor space, same deeply residential power tariff." },
  { key: "livingRoom", name: "Living Room Fitout", maxMachines: 5, powerCapacity: 2100, upgradeCost: 5200, earningsRequirement: 3000, powerRateModifier: 1.24, solarEfficiency: 0.88, solarAllowed: true, prerequisiteFacilityKeys: ["bedroom"], description: "Guests now have to sit somewhere else." },
  { key: "fullHouse", name: "Full House Refit", maxMachines: 10, powerCapacity: 6200, upgradeCost: 18500, earningsRequirement: 12000, powerRateModifier: 1.16, solarEfficiency: 1.02, solarAllowed: true, prerequisiteFacilityKeys: ["secondBedroom", "livingRoom"], description: "Every room is now an acoustic treatment for fan noise." },
  { key: "garage", name: "Garage Operation", maxMachines: 8, powerCapacity: 4200, upgradeCost: 3500, earningsRequirement: 2000, powerRateModifier: 1.05, solarEfficiency: 0.94, solarAllowed: true, prerequisiteFacilityKeys: [], description: "Your neighbors have questions." },
  { key: "garageExtension", name: "Garage Extension", maxMachines: 12, powerCapacity: 7800, upgradeCost: 9800, earningsRequirement: 6500, powerRateModifier: 0.98, solarEfficiency: 1.05, solarAllowed: true, prerequisiteFacilityKeys: ["garage"], description: "Adds space, airflow, and several planning regrets." },
  { key: "storageSmall", name: "Small Storage Unit", maxMachines: 6, powerCapacity: 2600, upgradeCost: 4800, earningsRequirement: 3200, powerRateModifier: 1.12, solarEfficiency: 0, solarAllowed: false, prerequisiteFacilityKeys: [], description: "Cheap walls, expensive power, zero roof rights." },
  { key: "storageMedium", name: "Medium Storage Unit", maxMachines: 10, powerCapacity: 5200, upgradeCost: 12800, earningsRequirement: 9000, powerRateModifier: 1.08, solarEfficiency: 0, solarAllowed: false, prerequisiteFacilityKeys: [], description: "Plenty of square footage, still no solar and suspicious ventilation." },
  { key: "storageLarge", name: "Large Storage Unit", maxMachines: 16, powerCapacity: 9800, upgradeCost: 29500, earningsRequirement: 22000, powerRateModifier: 1.02, solarEfficiency: 0, solarAllowed: false, prerequisiteFacilityKeys: [], description: "Bigger shutters, same landlord, same no-panels policy." },
  { key: "bareLand", name: "Bare Land Lease", maxMachines: 5, powerCapacity: 3600, upgradeCost: 14000, earningsRequirement: 10000, powerRateModifier: 0.96, solarEfficiency: 1.18, solarAllowed: true, prerequisiteFacilityKeys: [], description: "A patch of dirt with ambition and an extension cord." },
  { key: "containerSingle", name: "Single Container Yard", maxMachines: 10, powerCapacity: 8200, upgradeCost: 28000, earningsRequirement: 18000, powerRateModifier: 0.9, solarEfficiency: 1.15, solarAllowed: true, prerequisiteFacilityKeys: ["bareLand"], description: "One container, plenty of echo, strong solar economics." },
  { key: "containerDouble", name: "Double Container Yard", maxMachines: 18, powerCapacity: 16500, upgradeCost: 62000, earningsRequirement: 42000, powerRateModifier: 0.86, solarEfficiency: 1.18, solarAllowed: true, prerequisiteFacilityKeys: ["containerSingle"], description: "Now it looks intentional from a distance." },
  { key: "warehouse", name: "Small Warehouse", maxMachines: 16, powerCapacity: 14000, upgradeCost: 26000, earningsRequirement: 16000, powerRateModifier: 0.93, solarEfficiency: 1.04, solarAllowed: true, prerequisiteFacilityKeys: [], description: "Now with forklifts and passive-aggressive invoices." },
  { key: "datacentre", name: "Datacentre", maxMachines: 32, powerCapacity: 42000, upgradeCost: 135000, earningsRequirement: 90000, powerRateModifier: 0.82, solarEfficiency: 1.12, solarAllowed: true, prerequisiteFacilityKeys: [], description: "Finally, a professional venue for your terrible ideas." }
];

const SOLAR_DEFS = [
  { key: "balconyPanel", name: "Balcony Panel", price: 450, offsetWatts: 90, facilityTierRequired: 0, description: "Small, earnest, and unlikely to impress the grid." },
  { key: "garageArray", name: "Garage Array", price: 2800, offsetWatts: 620, facilityTierRequired: 1, description: "A serious roofline commitment to lower bills." },
  { key: "warehouseCanopy", name: "Warehouse Canopy", price: 16500, offsetWatts: 4200, facilityTierRequired: 2, description: "Large enough to make your utility nervous." },
  { key: "solarFieldLease", name: "Solar Field Lease", price: 92000, offsetWatts: 18000, facilityTierRequired: 3, description: "Finally, the sun is on payroll." }
];

const COOLING_LEVELS = [
  { key: "stock", name: "Stock Cooling", price: 0, wearReduction: 0, powerDraw: 0, durability: 999999, description: "Factory airflow and crossed fingers." },
  { key: "tower", name: "Aftermarket Tower", price: 260, wearReduction: 0.16, powerDraw: 12, durability: 120, description: "Less screaming, slightly more science." },
  { key: "loop", name: "Closed Loop Cooling", price: 880, wearReduction: 0.3, powerDraw: 24, durability: 150, description: "A tidy compromise between thermals and leaks." },
  { key: "chiller", name: "Rack Chiller", price: 3200, wearReduction: 0.46, powerDraw: 55, durability: 190, description: "Cold enough to justify terrible decisions." }
];

const FEATURE_UNLOCK_DEFS = {
  cooling: {
    key: "cooling",
    name: "Cooling",
    requirement: { type: "earnings", value: 750 },
    description: "Unlock aftermarket cooling hardware and thermal management upgrades."
  },
  overclocking: {
    key: "overclocking",
    name: "Overclocking",
    requirement: { type: "hashrate", value: 40 },
    description: "Unlock per-part overclock sliders for GPUs, CPUs, RAM, and PSUs."
  },
  marketManipulation: {
    key: "marketManipulation",
    name: "Market Manipulation",
    requirement: { type: "earnings", value: 25000 },
    description: "Reserved for future market meddling. Unlock it now, abuse it later."
  }
};

let state = null;
let dom = {};
let pendingInstallAction = null;
let memorySaveFallback = null;

function getStorageValue(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    return memorySaveFallback;
  }
}

function setStorageValue(key, value) {
  try {
    window.localStorage.setItem(key, value);
    memorySaveFallback = value;
  } catch (error) {
    memorySaveFallback = value;
  }
}

function removeStorageValue(key) {
  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    // Ignore storage errors and clear the in-memory fallback instead.
  }
  memorySaveFallback = null;
}

function createEmptySolarInventory() {
  const inventory = {};
  SOLAR_DEFS.forEach((solar) => {
    inventory[solar.key] = 0;
  });
  return inventory;
}

function createEmptyExternalPowerInventory() {
  const inventory = {};
  EXTERNAL_POWER_DEFS.forEach((item) => {
    inventory[item.key] = 0;
  });
  return inventory;
}

function createInitialPerformanceHistory() {
  return {
    power: [],
    hashrate: [],
    lastRecordedAt: 0
  };
}

function createInitialUnlockState() {
  const featureUnlocks = {};
  Object.keys(FEATURE_UNLOCK_DEFS).forEach((key) => {
    featureUnlocks[key] = false;
  });
  const coinUnlocks = {};
  Object.keys(COIN_DEFS).forEach((coinKey) => {
    coinUnlocks[coinKey] = coinKey === "dogeish";
  });
  return {
    features: featureUnlocks,
    coins: coinUnlocks
  };
}

function createSite(facilityKey, explicitId = null) {
  const siteId = explicitId !== null && explicitId !== undefined ? explicitId : `site-${state ? state.meta.nextSiteId++ : 1}`;
  return {
    id: siteId,
    facilityKey,
    solar: createEmptySolarInventory(),
    externalPower: createEmptyExternalPowerInventory()
  };
}

function createEmptyMachineComponents(typeKey) {
  const slots = MACHINE_DEFS[typeKey].componentSlots || { mainboard: 1, cpu: 1, ram: 1, psu: 1 };
  return {
    mainboard: null,
    cpu: Array(slots.cpu || 1).fill(null),
    ram: Array(slots.ram || 1).fill(null),
    psu: Array(1).fill(null)
  };
}

function getMachinePsuSlotCapacity(machine) {
  const onboardSlots = 1;
  const baySlots = (machine.psuBays || []).reduce((sum, bayKey) => sum + ((PSU_BAY_DEFS[bayKey] && PSU_BAY_DEFS[bayKey].addedSlots) || 0), 0);
  return onboardSlots + baySlots;
}

function ensurePsuSlotArray(machine) {
  const requiredLength = getMachinePsuSlotCapacity(machine);
  if (!Array.isArray(machine.components.psu)) {
    machine.components.psu = [machine.components.psu || null];
  }
  while (machine.components.psu.length < requiredLength) {
    machine.components.psu.push(null);
  }
  if (machine.components.psu.length > requiredLength) {
    machine.components.psu.length = requiredLength;
  }
}

function getComponentSlotCount(machine, category) {
  if (category === "psu") return getMachinePsuSlotCapacity(machine);
  const slots = MACHINE_DEFS[machine.type].componentSlots || { mainboard: 1, cpu: 1, ram: 1, psu: 1 };
  return slots[category] || 1;
}

function getComponentSlots(machine, category) {
  if (!machine || !machine.components) return [];
  if (category === "mainboard") {
    return [machine.components.mainboard || null];
  }
  if (category === "psu") {
    ensurePsuSlotArray(machine);
  }
  const slots = machine.components[category];
  if (Array.isArray(slots)) return slots;
  return [slots || null];
}

function setComponentSlot(machine, category, slotIndex, component) {
  if (category === "mainboard") {
    machine.components.mainboard = component;
    return;
  }
  if (!Array.isArray(machine.components[category])) {
    machine.components[category] = Array(getComponentSlotCount(machine, category)).fill(null);
  }
  if (category === "psu") {
    ensurePsuSlotArray(machine);
  }
  machine.components[category][slotIndex] = component;
}

function getInstalledComponents(machine) {
  const installed = [];
  ["mainboard", "cpu", "ram", "psu"].forEach((category) => {
    getComponentSlots(machine, category).forEach((component, slotIndex) => {
      if (component) {
        installed.push({
          category,
          slotIndex,
          component
        });
      }
    });
  });
  return installed;
}

function migrateLegacyPsuBays(machine, existingPsuSlots) {
  const def = MACHINE_DEFS[machine.type];
  const allowedSizes = def.allowedPsuBaySizes || [];
  const bays = [];
  let remainingExtraSlots = Math.max(0, existingPsuSlots - 1);
  const sizesByCapacity = allowedSizes
    .map((key) => PSU_BAY_DEFS[key])
    .filter((entry) => !!entry)
    .sort((a, b) => b.addedSlots - a.addedSlots);

  while (remainingExtraSlots > 0 && bays.length < (def.maxPsuBayCount || 0)) {
    let chosen = null;
    for (let i = 0; i < sizesByCapacity.length; i++) {
      if (sizesByCapacity[i].addedSlots <= remainingExtraSlots) {
        chosen = sizesByCapacity[i];
        break;
      }
    }
    if (!chosen) {
      chosen = sizesByCapacity[sizesByCapacity.length - 1];
    }
    if (!chosen) break;
    bays.push(chosen.key);
    remainingExtraSlots -= chosen.addedSlots;
  }

  return bays;
}

function getWorkingComponents(machine, category) {
  return getComponentSlots(machine, category).filter((component) => component && !component.dead && component.durability > 0);
}

function getCpuScaleFraction(machine) {
  const requiredCpuCount = getComponentSlotCount(machine, "cpu");
  if (requiredCpuCount <= 0) return 1;
  return clamp(getWorkingComponents(machine, "cpu").length / requiredCpuCount, 0, 1);
}

function getEnabledRamSlotCount(machine) {
  const totalRamSlots = getComponentSlotCount(machine, "ram");
  const cpuFraction = getCpuScaleFraction(machine);
  if (cpuFraction <= 0) return 0;
  return Math.max(1, Math.floor(totalRamSlots * cpuFraction));
}

function getEnabledGpuSlotCount(machine) {
  const totalGpuSlots = getMachineSlotCapacity(machine);
  const cpuFraction = getCpuScaleFraction(machine);
  if (cpuFraction <= 0) return 0;
  return Math.max(1, Math.floor(totalGpuSlots * cpuFraction));
}

function getActiveMachineGpus(machine) {
  return machine.installedGPUs
    .filter((gpu) => !gpu.dead && gpu.durability > 0)
    .slice(0, getEnabledGpuSlotCount(machine));
}

function getActiveRamComponents(machine) {
  return getWorkingComponents(machine, "ram").slice(0, getEnabledRamSlotCount(machine));
}

function createInitialState() {
  const market = {};
  const inventory = {};
  const priceHistory = {};

  Object.values(COIN_DEFS).forEach((coin) => {
    market[coin.key] = {
      price: coin.currentPrice,
      trend: coin.trend,
      lastChangePct: 0,
      allTimeHigh: coin.currentPrice,
      allTimeLow: coin.currentPrice
    };
    inventory[coin.key] = 0;
    priceHistory[coin.key] = [coin.currentPrice];
  });

  const starterMachine = createMachine("starterPc");
  const starterSite = createSite("bedroom", "site-1");
  starterMachine.siteId = starterSite.id;
  const starterGpu = createGpuInstance("pixelblazer960", false);
  starterMachine.installedGPUs.push(starterGpu);
  starterMachine.components.mainboard = createComponentInstance("laneLordB450", false);
  starterMachine.components.mainboard.id = "component-1";
  starterMachine.components.cpu[0] = createComponentInstance("threadBaron3", false);
  starterMachine.components.cpu[0].id = "component-2";
  starterMachine.components.ram[0] = createComponentInstance("cacheStick16", false);
  starterMachine.components.ram[0].id = "component-3";
  starterMachine.components.psu[0] = createComponentInstance("bronzeBrick550", false);
  starterMachine.components.psu[0].id = "component-4";
  starterMachine.assignedCoin = "dogeish";

  return {
    cash: 120,
    lifetimeEarnings: 0,
    unlocks: createInitialUnlockState(),
    history: createInitialPerformanceHistory(),
    inventory,
    market,
    priceHistory,
    sites: [starterSite],
    machines: [starterMachine],
    spareGpus: [],
    spareComponents: [],
    usedMarketOffers: [],
    eventLog: [],
    meta: {
      nextSiteId: 2,
      nextMachineId: 2,
      nextGpuId: 2,
      nextComponentId: 5,
      lastUpdated: Date.now(),
      lastSaveAt: Date.now(),
      lastMarketTick: Date.now(),
      lastPowerTick: Date.now(),
      lastUsedRefresh: 0,
      usedMarketRefreshAt: Date.now() + USED_MARKET_TICK_MS,
      powerRatePerKwTick: 0.18
    },
    cheats: {
      miningSpeedMultiplier: 1,
      showVolatility: false
    },
    ui: {
      lastOfflineSummary: null,
      theme: "light",
      collapsedMachines: {},
      collapsedComponentGroups: {},
      collapsedShopComponentGroups: {},
      collapsedShopSections: {
        machines: false,
        components: false,
        spareComponents: false,
        facility: false,
        solar: false
      },
      collapsedPanels: {
        market: false,
        usedMarket: false,
        operation: false,
        shop: false,
        unlocks: false,
        eventLog: false,
        cheats: false
      }
    }
  };
}

function createMachine(typeKey) {
  const def = MACHINE_DEFS[typeKey];
  const machine = {
    id: `machine-${state ? state.meta.nextMachineId++ : 1}`,
    type: typeKey,
    gpuSlots: def.gpuSlots,
    extraSlots: 0,
    psuBays: [],
    installedGPUs: [],
    missingGpuFailure: false,
    components: createEmptyMachineComponents(typeKey),
    assignedCoin: "dogeish",
    coolingLevel: "stock",
    coolingDurability: getCoolingDef("stock").durability,
    coolingMaxDurability: getCoolingDef("stock").durability,
    coolingFailed: false,
    baseEfficiency: def.baseEfficiency,
    health: 100,
    status: "idle",
    repairCount: 0,
    faultedPartLabel: null
  };
  ensurePsuSlotArray(machine);
  return machine;
}

function createGpuInstance(gpuKey, used = false, overrideDurability) {
  const def = GPU_DEFS[gpuKey];
  const startingDurability = overrideDurability !== undefined && overrideDurability !== null ? overrideDurability : (used
    ? randomInRange(def.durability * 0.36, def.durability * 0.78)
    : def.durability);

  const gpuId = state ? state.meta.nextGpuId++ : 1;
  return {
    id: `gpu-${gpuId}`,
    key: gpuKey,
    name: def.name,
    hashrate: def.hashrate,
    powerDraw: def.powerDraw,
    price: def.price,
    maxDurability: def.durability,
    durability: roundTo(startingDurability, 1),
    overclockPct: 0,
    faultCount: 0,
    efficiencyModifier: def.efficiencyModifier,
    used,
    failureRiskModifier: used ? def.failureRiskModifier * 1.28 : def.failureRiskModifier,
    dead: false
  };
}

function createComponentInstance(componentKey, used = false, overrideDurability) {
  const def = getComponentDef(componentKey);
  const startingDurability = overrideDurability !== undefined && overrideDurability !== null ? overrideDurability : (used
    ? randomInRange(def.durability * 0.42, def.durability * 0.82)
    : def.durability);

  const componentId = state ? state.meta.nextComponentId++ : 1;
  return {
    id: `component-${componentId}`,
    key: componentKey,
    category: def.category,
    name: def.name,
    price: def.price,
    powerDraw: def.powerDraw,
    maxDurability: def.durability,
    durability: roundTo(startingDurability, 1),
    overclockPct: 0,
    faultCount: 0,
    efficiencyModifier: def.efficiencyModifier,
    used,
    failureRiskModifier: used ? def.failureRiskModifier * 1.22 : def.failureRiskModifier,
    dead: false
  };
}

function getComponentDef(componentKey) {
  const categories = Object.keys(COMPONENT_DEFS);
  for (let i = 0; i < categories.length; i++) {
    const group = COMPONENT_DEFS[categories[i]];
    const keys = Object.keys(group);
    for (let j = 0; j < keys.length; j++) {
      const component = group[keys[j]];
      if (component.key === componentKey) return component;
    }
  }
  return null;
}

function getCoolingDef(levelKey) {
  return COOLING_LEVELS.find((level) => level.key === levelKey) || COOLING_LEVELS[0];
}

function initializeCoolingState(machine, levelKey) {
  const def = getCoolingDef(levelKey || machine.coolingLevel || "stock");
  machine.coolingLevel = def.key;
  machine.coolingDurability = def.key === "stock" ? def.durability : def.durability;
  machine.coolingMaxDurability = def.durability;
  machine.coolingFailed = false;
}

function getCoolingDurabilityRatio(machine) {
  if (!machine || machine.coolingLevel === "stock") return 1;
  const max = machine.coolingMaxDurability || getCoolingDef(machine.coolingLevel).durability || 1;
  return clamp((machine.coolingDurability || 0) / max, 0, 1);
}

function getEffectiveCooling(machine) {
  const def = getCoolingDef(machine.coolingLevel);
  if (machine.coolingLevel === "stock" || machine.coolingFailed) return def;
  const ratio = getCoolingDurabilityRatio(machine);
  return {
    ...def,
    wearReduction: def.wearReduction * (0.4 + ratio * 0.6),
    powerDraw: def.powerDraw * (0.75 + ratio * 0.25)
  };
}

function degradeCooling(machine, cooling, offline) {
  if (!machine || machine.coolingLevel === "stock" || machine.coolingFailed) return;
  const activeGpus = getActiveMachineGpus(machine).length;
  const activeComponents = getActiveComponents(machine).filter((component) => component.category !== "psu").length;
  const workload = Math.max(1, activeGpus + activeComponents * 0.5);
  const overclockPressure = machine.installedGPUs.reduce((sum, gpu) => sum + getPartOverclockPct(gpu), 0)
    + getInstalledComponents(machine).reduce((sum, entry) => sum + ((entry.component.category === "cpu" || entry.component.category === "ram" || entry.component.category === "psu") ? getPartOverclockPct(entry.component) : 0), 0);
  const wear = 0.01 + workload * 0.0025 + overclockPressure * 0.00012;
  machine.coolingDurability = clamp((machine.coolingDurability || 0) - wear, 0, machine.coolingMaxDurability || cooling.durability);
  if (machine.coolingDurability <= 0 && !machine.coolingFailed) {
    machine.coolingFailed = true;
    if (!offline) addLog(`${cooling.name} failed in ${MACHINE_DEFS[machine.type].name}. Thermals have fallen back to stock-grade hope.`, "loss");
  }
}

function getPartOverclockPct(part) {
  return clamp(Number(part && part.overclockPct) || 0, 0, 100);
}

function getGpuOutputMultiplier(gpu) {
  return 1 + getPartOverclockPct(gpu) * 0.0035;
}

function getGpuPowerMultiplier(gpu) {
  return 1 + getPartOverclockPct(gpu) * 0.004;
}

function getGpuWearMultiplier(gpu, cooling) {
  const raw = 1 + getPartOverclockPct(gpu) * 0.01;
  return 1 + (raw - 1) * (1 - cooling.wearReduction);
}

function getComputeComponentEfficiencyMultiplier(component) {
  return 1 + getPartOverclockPct(component) * 0.0025;
}

function getComputeComponentPowerMultiplier(component) {
  return 1 + getPartOverclockPct(component) * 0.003;
}

function getComputeComponentWearMultiplier(component, cooling) {
  const raw = 1 + getPartOverclockPct(component) * 0.009;
  return 1 + (raw - 1) * (1 - cooling.wearReduction);
}

function getPsuCapacityMultiplier(component) {
  return 1 + getPartOverclockPct(component) * 0.0035;
}

function getPsuWearMultiplier(component, cooling) {
  const raw = 1 + getPartOverclockPct(component) * 0.01;
  return 1 + (raw - 1) * (1 - cooling.wearReduction);
}

function getDisplayedComponentEfficiency(component) {
  if (!component) return 0;
  if (component.category === "cpu" || component.category === "ram") {
    return component.efficiencyModifier * getComputeComponentEfficiencyMultiplier(component);
  }
  return component.efficiencyModifier;
}

function getDisplayedComponentPower(component) {
  if (!component) return 0;
  if (component.category === "cpu" || component.category === "ram") {
    return component.powerDraw * getComputeComponentPowerMultiplier(component);
  }
  return component.powerDraw;
}

function getDisplayedPsuCapacity(component) {
  if (!component) return 0;
  const def = getComponentDef(component.key);
  return ((def && def.wattage) || 0) * getPsuCapacityMultiplier(component);
}

function getSoftFaultChance(part) {
  const pct = getPartOverclockPct(part);
  if (pct <= 0) return 0;
  const intensity = (pct / 100) ** 1.65;
  const usedPenalty = part.used ? 1.22 : 1;
  const base = part.category === "gpu" ? 0.000035 : part.category === "psu" ? 0.00003 : 0.000025;
  return base * intensity * usedPenalty;
}

function triggerSoftFault(machine, part, offline) {
  part.faultCount = (part.faultCount || 0) + 1;
  machine.status = "faulted";
  machine.faultedPartLabel = part.name;
  if (!offline) {
    addLog(`${part.name} in ${MACHINE_DEFS[machine.type].name} faulted under overclock and needs a reboot.`, "warn");
  }
  return 1;
}

function getDisplayedGpuEfficiency(gpu) {
  if (!gpu) return 0;
  return gpu.efficiencyModifier * getGpuOutputMultiplier(gpu);
}

function getDisplayedGpuPower(gpu) {
  if (!gpu) return 0;
  return gpu.powerDraw * getGpuPowerMultiplier(gpu);
}

function getDisplayedGpuHashrate(gpu) {
  if (!gpu) return 0;
  return gpu.hashrate * getGpuOutputMultiplier(gpu);
}

function init() {
  cacheDom();
  loadGame();
  attachEvents();
  if (!state.usedMarketOffers.length) refreshUsedMarket(true);
  applyOfflineProgress();
  renderAll();
  setInterval(gameTick, GAME_TICK_MS);
  setInterval(maybeMarketTick, 1000);
  setInterval(maybePowerTick, 1000);
  setInterval(maybeUsedMarketRefresh, 1000);
  setInterval(saveGame, AUTOSAVE_MS);
}

function cacheDom() {
  dom.summaryBar = document.getElementById("summary-bar");
  dom.marketPanel = document.getElementById("market-panel");
  dom.operationPanel = document.getElementById("operation-panel");
  dom.machineShop = document.getElementById("machine-shop");
  dom.componentShop = document.getElementById("component-shop");
  dom.spareComponentShop = document.getElementById("spare-component-shop");
  dom.facilityShop = document.getElementById("facility-shop");
  dom.solarShop = document.getElementById("solar-shop");
  dom.unlockPanel = document.getElementById("unlock-panel");
  dom.usedMarketPanel = document.getElementById("used-market-panel");
  dom.usedMarketTimer = document.getElementById("used-market-timer");
  dom.eventLogPanel = document.getElementById("event-log-panel");
  dom.cheatPanel = document.getElementById("cheat-panel");
  dom.marketSummary = document.getElementById("market-summary");
  dom.usedMarketSummary = document.getElementById("used-market-summary");
  dom.operationSummary = document.getElementById("operation-summary");
  dom.shopSummary = document.getElementById("shop-summary");
  dom.unlockSummary = document.getElementById("unlock-summary");
  dom.eventLogSummary = document.getElementById("event-log-summary");
  dom.cheatSummary = document.getElementById("cheat-summary");
  dom.versionLabel = document.getElementById("version-label");
  dom.themeButton = document.getElementById("theme-button");
  dom.saveButton = document.getElementById("save-button");
  dom.resetButton = document.getElementById("reset-button");
  dom.sellAllButton = document.getElementById("sell-all-button");
  dom.offlineModal = document.getElementById("offline-modal");
  dom.offlineSummary = document.getElementById("offline-summary");
  dom.offlineCloseButton = document.getElementById("offline-close-button");
  dom.slotModal = document.getElementById("slot-modal");
  dom.slotModalCopy = document.getElementById("slot-modal-copy");
  dom.slotModalOptions = document.getElementById("slot-modal-options");
  dom.slotCloseButton = document.getElementById("slot-close-button");
}

function attachEvents() {
  dom.saveButton.addEventListener("click", () => {
    saveGame();
    addLog("Manual save complete. Compliance theatre successful.", "system");
    renderEventLog();
  });

  dom.themeButton.addEventListener("click", toggleTheme);
  dom.resetButton.addEventListener("click", () => {
    const confirmed = window.confirm("Reset Mooncoin Miner? This deletes the save.");
    if (!confirmed) return;
    removeStorageValue(SAVE_KEY);
    state = createInitialState();
    addLog("Operation reset. The market pretends this was strategic.", "warn");
    refreshUsedMarket(true);
    renderAll();
  });

  dom.sellAllButton.addEventListener("click", sellAllCoins);
  dom.offlineCloseButton.addEventListener("click", () => toggleOfflineModal(false));
  dom.slotCloseButton.addEventListener("click", closeSlotModal);
  document.querySelectorAll("[data-action='toggle-panel']").forEach((button) => {
    button.addEventListener("click", () => togglePanel(button.dataset.panel));
  });
  document.querySelectorAll("[data-action='toggle-shop-section']").forEach((button) => {
    button.addEventListener("click", () => toggleShopSection(button.dataset.section));
  });
}

function loadGame() {
  const raw = getStorageValue(SAVE_KEY);
  if (!raw) {
    state = createInitialState();
    addLog("You booted a single gaming PC and called it a business model.", "system");
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    state = createInitialState();
    state = {
      ...state,
      ...parsed,
      meta: { ...state.meta, ...parsed.meta },
      cheats: { ...state.cheats, ...parsed.cheats },
      ui: { ...state.ui, ...parsed.ui }
    };
    state.unlocks = {
      ...createInitialUnlockState(),
      ...(parsed.unlocks || {})
    };
    state.unlocks.features = {
      ...createInitialUnlockState().features,
      ...((parsed.unlocks && parsed.unlocks.features) || {})
    };
    state.unlocks.coins = {
      ...createInitialUnlockState().coins,
      ...((parsed.unlocks && parsed.unlocks.coins) || {})
    };
    state.history = {
      ...createInitialPerformanceHistory(),
      ...(parsed.history || {})
    };
    state.history.power = Array.isArray(state.history.power) ? state.history.power.slice(-PERFORMANCE_HISTORY_LIMIT) : [];
    state.history.hashrate = Array.isArray(state.history.hashrate) ? state.history.hashrate.slice(-PERFORMANCE_HISTORY_LIMIT) : [];
    state.history.lastRecordedAt = Number(state.history.lastRecordedAt) || 0;
    state.spareComponents = state.spareComponents || [];
    state.meta.nextComponentId = state.meta.nextComponentId || 1;
    state.meta.nextSiteId = state.meta.nextSiteId || 1;
    if (!state.sites || !state.sites.length) {
      const oldTier = state.facilityTier || 0;
      const legacyFacilityKeys = ["bedroom", "garage", "warehouse", "datacentre"];
      state.sites = legacyFacilityKeys.slice(0, oldTier + 1).map((facilityKey, index) => {
        const facility = getFacilityByKey(facilityKey);
        const site = createSite(facility.key, `site-${index + 1}`);
        if (index === oldTier && state.solar) {
          site.solar = { ...site.solar, ...state.solar };
        }
        return site;
      });
      state.meta.nextSiteId = state.sites.length + 1;
      const defaultSiteId = state.sites[state.sites.length - 1].id;
      state.machines.forEach((machine) => {
        machine.siteId = machine.siteId || defaultSiteId;
      });
    }
    state.sites = state.sites.map((site, index) => ({
      id: site.id || `site-${index + 1}`,
      facilityKey: site.facilityKey,
      solar: { ...createEmptySolarInventory(), ...site.solar },
      externalPower: { ...createEmptyExternalPowerInventory(), ...(site.externalPower || {}) }
    }));
    state.meta.nextSiteId = Math.max(state.meta.nextSiteId, state.sites.length + 1);
    state.usedMarketOffers = (state.usedMarketOffers || []).map((offer) => ({
      kind: offer.kind || "gpu",
      ...offer
    }));
    Object.keys(COIN_DEFS).forEach((coinKey) => {
      const market = state.market[coinKey];
      const history = state.priceHistory[coinKey] || [market.price];
      market.allTimeHigh = market.allTimeHigh || Math.max(...history, market.price);
      market.allTimeLow = market.allTimeLow || Math.min(...history, market.price);
    });
    state.machines.forEach((machine) => {
      const existingComponents = machine.components || {};
      const emptyComponents = createEmptyMachineComponents(machine.type);
      const legacyPsuSlots = Array.isArray(existingComponents.psu)
        ? existingComponents.psu.slice()
        : [existingComponents.psu || null];
      machine.psuBays = Array.isArray(machine.psuBays)
        ? machine.psuBays.filter((key) => !!PSU_BAY_DEFS[key]).slice(0, MACHINE_DEFS[machine.type].maxPsuBayCount || 0)
        : migrateLegacyPsuBays(machine, legacyPsuSlots.length);
      machine.components = {
        mainboard: existingComponents.mainboard || null,
        cpu: Array.isArray(existingComponents.cpu)
          ? emptyComponents.cpu.map((_, index) => existingComponents.cpu[index] || null)
          : emptyComponents.cpu.map((_, index) => (index === 0 ? existingComponents.cpu || null : null)),
        ram: Array.isArray(existingComponents.ram)
          ? emptyComponents.ram.map((_, index) => existingComponents.ram[index] || null)
          : emptyComponents.ram.map((_, index) => (index === 0 ? existingComponents.ram || null : null)),
        psu: legacyPsuSlots
      };
      ensurePsuSlotArray(machine);
      machine.extraSlots = machine.extraSlots || 0;
      machine.missingGpuFailure = machine.missingGpuFailure || false;
      machine.coolingLevel = machine.coolingLevel || "stock";
      machine.coolingMaxDurability = machine.coolingMaxDurability || getCoolingDef(machine.coolingLevel).durability;
      machine.coolingDurability = machine.coolingDurability !== undefined ? machine.coolingDurability : machine.coolingMaxDurability;
      machine.coolingFailed = !!machine.coolingFailed;
      machine.faultedPartLabel = machine.faultedPartLabel || null;
      machine.siteId = machine.siteId || state.sites[0].id;
      if (machine.coolingLevel === "stock") initializeCoolingState(machine, "stock");
      if (machine.coolingLevel !== "stock") state.unlocks.features.cooling = true;
      machine.installedGPUs.forEach((gpu) => {
        gpu.overclockPct = gpu.overclockPct || 0;
        gpu.faultCount = gpu.faultCount || 0;
        if (getPartOverclockPct(gpu) > 0) state.unlocks.features.overclocking = true;
      });
      getInstalledComponents(machine).forEach((entry) => {
        const component = entry.component;
        component.overclockPct = component.overclockPct || 0;
        component.faultCount = component.faultCount || 0;
        if (getPartOverclockPct(component) > 0) state.unlocks.features.overclocking = true;
      });
      if (machine.assignedCoin && machine.assignedCoin !== "dogeish") state.unlocks.coins[machine.assignedCoin] = true;
    });
    Object.keys(state.inventory || {}).forEach((coinKey) => {
      if ((state.inventory[coinKey] || 0) > 0) state.unlocks.coins[coinKey] = true;
    });
    state.ui.collapsedShopSections = { ...createInitialState().ui.collapsedShopSections, ...state.ui.collapsedShopSections };
    state.ui.collapsedComponentGroups = state.ui.collapsedComponentGroups || {};
    state.ui.collapsedShopComponentGroups = state.ui.collapsedShopComponentGroups || {};
    delete state.ui.collapsedShopSections.gpus;
    delete state.ui.collapsedShopSections.spareGpus;
  } catch (error) {
    console.error(error);
    state = createInitialState();
    addLog("Save recovery failed. The blockchain has blamed weather.", "loss");
  }
}

function saveGame() {
  state.meta.lastSaveAt = Date.now();
  state.meta.lastUpdated = Date.now();
  setStorageValue(SAVE_KEY, JSON.stringify(state));
}

function applyOfflineProgress() {
  const now = Date.now();
  const elapsed = Math.min(now - (state.meta.lastUpdated || now), OFFLINE_CAP_MS);

  if (elapsed < 10000) {
    state.meta.lastUpdated = now;
    return;
  }

  const seconds = Math.floor(elapsed / 1000);
  const result = simulateMining(seconds, true);
  const powerBills = Math.floor(elapsed / POWER_TICK_MS);
  const powerCost = applyPowerCost(powerBills, true);

  state.ui.lastOfflineSummary = { elapsed, mined: result.mined, failures: result.failures, powerCost };
  state.meta.lastUpdated = now;
  state.meta.lastMarketTick = now;
  state.meta.lastPowerTick = now;
  state.meta.usedMarketRefreshAt = now + USED_MARKET_TICK_MS;
  showOfflineSummary();
}

function showOfflineSummary() {
  const summary = state.ui.lastOfflineSummary;
  if (!summary) return;

  const minedEntries = Object.entries(summary.mined)
    .filter(([, amount]) => amount > 0)
    .map(([coinKey, amount]) => `<li>${COIN_DEFS[coinKey].name}: ${formatCoin(amount)}</li>`)
    .join("");

  dom.offlineSummary.innerHTML = `
    <p>You were away for ${formatDuration(summary.elapsed)}. The rigs continued their measured descent into entropy.</p>
    <p><strong>Power costs:</strong> ${formatMoney(summary.powerCost)}</p>
    <p><strong>Failures while offline:</strong> ${summary.failures}</p>
    ${minedEntries ? `<p><strong>Mined:</strong></p><ul>${minedEntries}</ul>` : "<p>No meaningful mining occurred. The fans still complained.</p>"}
  `;

  toggleOfflineModal(true);
}

function toggleOfflineModal(show) {
  dom.offlineModal.classList.toggle("hidden", !show);
  dom.offlineModal.setAttribute("aria-hidden", String(!show));
  if (!show) state.ui.lastOfflineSummary = null;
}

function openSelectionModal(copy, options, onSelect, emptyMessage) {
  if (!options.length) {
    addLog(emptyMessage, "warn");
    renderShop();
    renderUsedMarket();
    renderEventLog();
    return;
  }
  pendingInstallAction = onSelect;
  dom.slotModalCopy.textContent = copy;
  dom.slotModalOptions.innerHTML = options.map((option) => `
    <button class="button" data-action="slot-choice" data-value="${option.value}">
      ${option.label}
    </button>
  `).join("");

  dom.slotModalOptions.querySelectorAll("[data-action='slot-choice']").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.dataset.value;
      const action = pendingInstallAction;
      closeSlotModal();
      if (action) action(value);
    });
  });

  dom.slotModal.classList.remove("hidden");
  dom.slotModal.setAttribute("aria-hidden", "false");
}

function openSlotModal(copy, onSelect) {
  const availableSlots = getAvailableInstallSlots();
  openSelectionModal(
    copy,
    availableSlots.map((slot) => ({ value: slot.machineId, label: slot.label })),
    onSelect,
    "No free GPU slot available. Buy more chassis before more silicon."
  );
}

function closeSlotModal() {
  pendingInstallAction = null;
  dom.slotModal.classList.add("hidden");
  dom.slotModal.setAttribute("aria-hidden", "true");
  dom.slotModalOptions.innerHTML = "";
}

function togglePanel(panelKey) {
  state.ui.collapsedPanels[panelKey] = !state.ui.collapsedPanels[panelKey];
  applyPanelCollapseState();
}

function toggleMachine(machineId) {
  state.ui.collapsedMachines[machineId] = !state.ui.collapsedMachines[machineId];
  renderOperation();
}

function toggleComponentGroup(machineId, category) {
  const key = `${machineId}:${category}`;
  state.ui.collapsedComponentGroups[key] = !state.ui.collapsedComponentGroups[key];
  renderOperation();
}

function toggleShopComponentGroup(sectionKey, category) {
  const key = `${sectionKey}:${category}`;
  state.ui.collapsedShopComponentGroups[key] = !state.ui.collapsedShopComponentGroups[key];
  renderShop();
}

function toggleShopSection(sectionKey) {
  state.ui.collapsedShopSections[sectionKey] = !state.ui.collapsedShopSections[sectionKey];
  applyShopSectionCollapseState();
}

function toggleTheme() {
  state.ui.theme = state.ui.theme === "dark" ? "light" : "dark";
  applyTheme();
}

function gameTick() {
  simulateMining(state.cheats.miningSpeedMultiplier || 1, false);
  state.meta.lastUpdated = Date.now();
  updateUnlocks();
  renderSummary();
  renderMarket();
  if (!isOperationControlFocused()) {
    renderOperation();
  }
  renderShop();
  renderUsedMarket();
  renderEventLog();
  renderCheats();
}

function maybeMarketTick() {
  const now = Date.now();
  if (now - state.meta.lastMarketTick < MARKET_TICK_MS) return;
  updateMarketPrices();
  state.meta.lastMarketTick = now;
  renderSummary();
  renderMarket();
  renderEventLog();
}

function maybePowerTick() {
  const now = Date.now();
  if (now - state.meta.lastPowerTick < POWER_TICK_MS) return;
  applyPowerCost(1, false);
  state.meta.lastPowerTick = now;
  renderSummary();
  renderEventLog();
}

function maybeUsedMarketRefresh() {
  const now = Date.now();
  if (now >= state.meta.usedMarketRefreshAt) {
    refreshUsedMarket(false);
    renderUsedMarket();
    renderEventLog();
  } else {
    renderUsedTimer();
  }
}

function getActiveComponents(machine) {
  const active = [];
  const mainboard = getWorkingComponents(machine, "mainboard")[0];
  if (mainboard) active.push(mainboard);
  getWorkingComponents(machine, "cpu").forEach((component) => active.push(component));
  getActiveRamComponents(machine).forEach((component) => active.push(component));
  getWorkingComponents(machine, "psu").forEach((component) => active.push(component));
  return active;
}

function hasMinimumCoreComponents(machine) {
  const hasMainboard = getWorkingComponents(machine, "mainboard").length >= 1;
  const hasCpu = getWorkingComponents(machine, "cpu").length >= 1;
  const hasEnoughRam = getWorkingComponents(machine, "ram").length >= 1;
  const hasPsu = getWorkingComponents(machine, "psu").length >= 1;
  return hasMainboard && hasCpu && hasEnoughRam && hasPsu;
}

function getMachineStatusReason(machine) {
  const reasons = [];
  const workingMainboards = getWorkingComponents(machine, "mainboard").length;
  const workingCpus = getWorkingComponents(machine, "cpu").length;
  const workingRam = getWorkingComponents(machine, "ram").length;
  const workingPsus = getWorkingComponents(machine, "psu").length;
  const workingGpuCount = machine.installedGPUs.filter((gpu) => !gpu.dead && gpu.durability > 0).length;
  const activeGpuCount = getActiveMachineGpus(machine).length;
  const enabledGpuSlots = getEnabledGpuSlotCount(machine);
  const totalGpuSlots = getMachineSlotCapacity(machine);
  const enabledRamSlots = getEnabledRamSlotCount(machine);
  const totalRamSlots = getComponentSlotCount(machine, "ram");
  const siteOverloaded = isSiteOverloaded(machine.siteId);

  if (machine.status === "faulted" && machine.faultedPartLabel) {
    reasons.push(`${machine.faultedPartLabel} faulted and the rig needs a reboot.`);
  }
  if (!workingMainboards) reasons.push("No working mainboard installed.");
  if (!workingCpus) reasons.push("No working CPU installed.");
  if (!workingRam) reasons.push("No working RAM installed.");
  if (!workingPsus) reasons.push("No working PSU installed.");
  if (!workingGpuCount) reasons.push("No working GPU installed.");
  else if (!activeGpuCount) reasons.push("Installed GPUs are outside current CPU-enabled capacity.");
  if (workingPsus && !hasEnoughPsuCapacity(machine)) reasons.push("PSU capacity is too low for the current load.");
  if (siteOverloaded) reasons.push(`Site power limit exceeded: ${formatNumber(getSiteProjectedPowerDraw(machine.siteId))} W projected on a ${formatNumber(getSitePowerLimit(machine.siteId))} W limit, causing an outage.`);
  if (machine.coolingLevel !== "stock") {
    if (machine.coolingFailed) reasons.push(`${getCoolingDef(machine.coolingLevel).name} has failed and is no longer reducing wear.`);
    else if (getCoolingDurabilityRatio(machine) <= 0.25) reasons.push(`${getCoolingDef(machine.coolingLevel).name} is heavily worn and providing reduced cooling.`);
  }
  if (!machine.assignedCoin) reasons.push("No coin is assigned.");
  if (workingCpus && workingCpus < getComponentSlotCount(machine, "cpu")) {
    reasons.push(`${workingCpus}/${getComponentSlotCount(machine, "cpu")} CPU live, enabling ${enabledGpuSlots}/${totalGpuSlots} GPU slots and ${enabledRamSlots}/${totalRamSlots} RAM slots.`);
  }
  if (!reasons.length) return machine.status === "mining" ? "Running normally." : "Waiting for work.";
  return reasons.join(" ");
}

function getMachineRequiredPower(machine) {
  const machineDef = MACHINE_DEFS[machine.type];
  const cooling = getEffectiveCooling(machine);
  const gpuPower = getActiveMachineGpus(machine)
    .reduce((sum, gpu) => sum + gpu.powerDraw * getGpuPowerMultiplier(gpu), 0);
  const componentPower = getActiveComponents(machine)
    .filter((component) => component && component.category !== "psu")
    .reduce((sum, component) => sum + component.powerDraw * ((component.category === "cpu" || component.category === "ram") ? getComputeComponentPowerMultiplier(component) : 1), 0);
  return machineDef.basePower + gpuPower + componentPower + cooling.powerDraw;
}

function hasEnoughPsuCapacity(machine) {
  const totalPsuCapacity = getComponentSlots(machine, "psu")
    .filter((psu) => psu && !psu.dead && psu.durability > 0)
    .reduce((sum, psu) => sum + getDisplayedPsuCapacity(psu), 0);
  return totalPsuCapacity >= getMachineRequiredPower(machine);
}

function getComponentDurabilityModifier(component) {
  const ratio = component.durability / component.maxDurability;
  return clamp(0.55 + ratio * 0.55, 0.3, 1.08);
}

function handleComponentFailure(machine, component, offline) {
  const destructionChance = component.used ? 0.44 : 0.2;
  component.dead = true;
  component.durability = 0;
  machine.status = "failed";
  if (!offline) {
    addLog(`${component.name} in ${MACHINE_DEFS[machine.type].name} failed${Math.random() < destructionChance ? " permanently" : ""}. Procurement has been informed.`, "loss");
  }
  return 1;
}

function simulateMining(seconds, offline) {
  const mined = {};
  let failures = 0;
  Object.keys(COIN_DEFS).forEach((key) => { mined[key] = 0; });

  for (let i = 0; i < seconds; i++) {
    state.machines.forEach((machine) => {
      updateMachineStatus(machine);
      if (machine.status !== "mining") return;

      const coinKey = machine.assignedCoin;
      if (!isCoinUnlocked(coinKey)) return;

      const activeGpus = getActiveMachineGpus(machine);
      const activeComponents = getActiveComponents(machine);
      if (!activeGpus.length || !hasMinimumCoreComponents(machine) || !hasEnoughPsuCapacity(machine)) {
        machine.status = "idle";
        return;
      }

      const cooling = getEffectiveCooling(machine);
      const totalHashrate = activeGpus.reduce((sum, gpu) => sum + getDisplayedGpuHashrate(gpu), 0);
      const avgEfficiency = activeGpus.reduce((sum, gpu) => sum + gpu.efficiencyModifier * getGpuDurabilityModifier(gpu) * getGpuOutputMultiplier(gpu), 0) / activeGpus.length;
      const tuningComponents = activeComponents.filter((component) => component.category === "cpu" || component.category === "ram");
      const baseComponentEfficiency = activeComponents.reduce((sum, component) => sum + component.efficiencyModifier * getComponentDurabilityModifier(component), 0) / activeComponents.length;
      const tuningEfficiency = tuningComponents.length
        ? tuningComponents.reduce((sum, component) => sum + component.efficiencyModifier * getComponentDurabilityModifier(component) * getComputeComponentEfficiencyMultiplier(component), 0) / tuningComponents.length
        : 1;
      const componentEfficiency = baseComponentEfficiency * tuningEfficiency;
      const healthModifier = clamp(machine.health / 100, 0.35, 1);
      const yieldPerSecond = totalHashrate * COIN_DEFS[coinKey].baseYield * 0.0024 * machine.baseEfficiency * avgEfficiency * componentEfficiency * healthModifier;

      state.inventory[coinKey] += yieldPerSecond;
      mined[coinKey] += yieldPerSecond;

      const averageGpuWearMultiplier = activeGpus.length
        ? activeGpus.reduce((sum, gpu) => sum + getGpuWearMultiplier(gpu, cooling), 0) / activeGpus.length
        : 1;
      machine.health = clamp(machine.health - (0.012 + activeGpus.length * 0.0015) * averageGpuWearMultiplier, 20, 100);

      let softFaultTriggered = false;
      activeGpus.forEach((gpu) => {
        const wear = (gpu.used ? 0.05 : 0.028) * getGpuWearMultiplier(gpu, cooling);
        gpu.durability = clamp(gpu.durability - wear, 0, gpu.maxDurability);

        const failureThreshold = gpu.maxDurability * 0.2;
        if (gpu.durability <= failureThreshold) {
          const repairPenalty = machine.repairCount * 0.00035;
          const usedPenalty = gpu.used ? 0.0012 : 0;
          const deathChance = 0.0011 + repairPenalty + usedPenalty + ((failureThreshold - gpu.durability) / gpu.maxDurability) * 0.004;
          if (Math.random() < deathChance) failures += handleGpuFailure(machine, gpu, offline);
        }
        if (!softFaultTriggered && Math.random() < getSoftFaultChance({ ...gpu, category: "gpu" })) {
          failures += triggerSoftFault(machine, gpu, offline);
          softFaultTriggered = true;
        }
      });

      activeComponents.forEach((component) => {
        if (component.category === "mainboard" || component.category === "psu") return;
        const wearMultiplier = (component.category === "cpu" || component.category === "ram")
          ? getComputeComponentWearMultiplier(component, cooling)
          : 1;
        const wear = (component.used ? 0.026 : 0.014) * wearMultiplier;
        component.durability = clamp(component.durability - wear, 0, component.maxDurability);
        const failureThreshold = component.maxDurability * 0.16;
        if (component.durability <= failureThreshold) {
          const deathChance = 0.0008 + (component.used ? 0.0008 : 0) + ((failureThreshold - component.durability) / component.maxDurability) * 0.0035;
          if (Math.random() < deathChance) failures += handleComponentFailure(machine, component, offline);
        }
        if (!softFaultTriggered && (component.category === "cpu" || component.category === "ram") && Math.random() < getSoftFaultChance(component)) {
          failures += triggerSoftFault(machine, component, offline);
          softFaultTriggered = true;
        }
      });

      getComponentSlots(machine, "psu").forEach((psu) => {
        if (!psu || psu.dead || psu.durability <= 0) return;
        const wear = (psu.used ? 0.02 : 0.011) * getPsuWearMultiplier(psu, cooling);
        psu.durability = clamp(psu.durability - wear, 0, psu.maxDurability);
        const failureThreshold = psu.maxDurability * 0.16;
        if (psu.durability <= failureThreshold) {
          const deathChance = 0.00075 + ((failureThreshold - psu.durability) / psu.maxDurability) * 0.0035;
          if (Math.random() < deathChance) failures += handleComponentFailure(machine, psu, offline);
        }
        if (!softFaultTriggered && Math.random() < getSoftFaultChance(psu)) {
          failures += triggerSoftFault(machine, psu, offline);
          softFaultTriggered = true;
        }
      });

      if (softFaultTriggered) return;

      degradeCooling(machine, cooling, offline);

      if (machine.health <= 27) {
        const machineFailChance = 0.00085 + machine.repairCount * 0.00025;
        if (Math.random() < machineFailChance) {
          machine.status = "failed";
          failures += 1;
          if (!offline) addLog(`${MACHINE_DEFS[machine.type].name} failed dramatically. The case now identifies as a heater.`, "loss");
        }
      }
    });
  }

  return { mined, failures };
}

function handleGpuFailure(machine, gpu, offline) {
  const destructionChance = gpu.used ? 0.52 : 0.24;
  const machineName = MACHINE_DEFS[machine.type].name;
  if (Math.random() < destructionChance) {
    gpu.dead = true;
    gpu.durability = 0;
    if (!offline) addLog(`${gpu.name} in ${machineName} expired permanently. It has joined e-waste heaven.`, "loss");
  } else {
    gpu.durability = Math.max(1, gpu.durability * 0.18);
    machine.status = "failed";
    if (!offline) addLog(`${gpu.name} in ${machineName} failed. It can probably be bullied back into service.`, "warn");
  }
  return 1;
}

function normalizeGpuState(gpu) {
  if (!gpu) return;
  if (gpu.durability <= 0) {
    gpu.durability = 0;
    gpu.dead = true;
  }
}

function normalizeComponentState(component) {
  if (!component) return;
  if (component.durability <= 0) {
    component.durability = 0;
    component.dead = true;
  }
}

function updateMachineStatus(machine) {
  machine.installedGPUs.forEach(normalizeGpuState);
  getInstalledComponents(machine).forEach((entry) => normalizeComponentState(entry.component));
  const hasWorkingGpu = getActiveMachineGpus(machine).length > 0;
  const hasCoreComponents = hasMinimumCoreComponents(machine);
  const hasPsuHeadroom = hasEnoughPsuCapacity(machine);
  const sitePowerOk = !isSiteOverloaded(machine.siteId);
  if (machine.status === "faulted") return;
  if (machine.status === "repairing") {
    machine.status = hasWorkingGpu && hasCoreComponents && hasPsuHeadroom && sitePowerOk ? "mining" : "idle";
    return;
  }
  if (machine.missingGpuFailure) {
    machine.status = hasWorkingGpu && hasCoreComponents && hasPsuHeadroom && sitePowerOk ? "mining" : "failed";
    if (hasWorkingGpu) machine.missingGpuFailure = false;
    return;
  }
  if (machine.status === "failed" && hasCoreComponents) {
    machine.status = hasWorkingGpu && machine.assignedCoin && hasPsuHeadroom && sitePowerOk ? "mining" : "idle";
    return;
  }
  if (!hasCoreComponents) {
    machine.status = "failed";
    return;
  }
  machine.status = hasWorkingGpu && machine.assignedCoin && hasPsuHeadroom && sitePowerOk ? "mining" : "idle";
}

function updateMarketPrices() {
  Object.values(COIN_DEFS).forEach((coin) => {
    const market = state.market[coin.key];
    const oldPrice = market.price;

    if (Math.random() < 0.25) {
      market.trend = clamp(market.trend + randomInRange(-0.01, 0.01), -0.03, 0.03);
    }

    let movement = randomInRange(-coin.volatility, coin.volatility) + market.trend;
    let eventText = "";
    let eventType = "system";

    if (Math.random() < 0.08) {
      const pump = Math.random() < 0.55;
      const shock = randomInRange(0.12, 0.38) * (pump ? 1 : -1);
      movement += shock;
      eventText = pump
        ? `${coin.name} caught a pump on pure narrative velocity.`
        : `${coin.name} crashed after investors rediscovered numeracy.`;
      eventType = pump ? "gain" : "loss";
    }

    market.price = Math.max(coin.minimumPrice, oldPrice * (1 + movement));
    market.lastChangePct = ((market.price - oldPrice) / oldPrice) * 100;
    market.allTimeHigh = Math.max(market.allTimeHigh || market.price, market.price);
    market.allTimeLow = Math.min(market.allTimeLow || market.price, market.price);
    pushPriceHistory(coin.key, market.price);

    if (eventText) addLog(eventText, eventType);
  });
}

function pushPriceHistory(coinKey, price) {
  const series = state.priceHistory[coinKey] || [];
  series.push(price);
  if (series.length > 12) series.shift();
  state.priceHistory[coinKey] = series;
}

function applyPowerCost(billCount, offline) {
  if (billCount <= 0) return 0;
  const totalCost = state.sites.reduce((sum, site) => sum + getSitePowerCostPerTick(site.id) * billCount, 0);
  state.cash = Math.max(0, state.cash - totalCost);

  if (!offline && totalCost > 0) {
    addLog(`Power bill processed: ${formatMoney(totalCost)}. The utility remains your most consistent counterparty.`, "warn");
  }

  return totalCost;
}

function refreshUsedMarket(initial) {
  const offerCount = initial ? 2 : 3;
  state.usedMarketOffers = Array.from({ length: offerCount }, () => {
    const kind = Math.random() < 0.58 ? "gpu" : "component";
    if (kind === "gpu") {
      const gpuKeys = Object.keys(GPU_DEFS);
      const key = gpuKeys[Math.floor(Math.random() * gpuKeys.length)];
      const def = GPU_DEFS[key];
      const durability = roundTo(randomInRange(def.durability * 0.36, def.durability * 0.78), 1);
      const priceFactor = randomInRange(0.48, 0.74);
      return {
        id: `offer-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        kind,
        gpuKey: key,
        price: Math.round(def.price * priceFactor),
        durability,
        expiresAt: Date.now() + USED_MARKET_TICK_MS
      };
    }

    const categories = Object.keys(COMPONENT_DEFS);
    const category = categories[Math.floor(Math.random() * categories.length)];
    const componentKeys = Object.keys(COMPONENT_DEFS[category]);
    const key = componentKeys[Math.floor(Math.random() * componentKeys.length)];
    const def = COMPONENT_DEFS[category][key];
    const durability = roundTo(randomInRange(def.durability * 0.42, def.durability * 0.82), 1);
    const priceFactor = randomInRange(0.5, 0.76);
    return {
      id: `offer-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      kind,
      category,
      componentKey: key,
      price: Math.round(def.price * priceFactor),
      durability,
      expiresAt: Date.now() + USED_MARKET_TICK_MS
    };
  });
  state.meta.lastUsedRefresh = Date.now();
  state.meta.usedMarketRefreshAt = Date.now() + USED_MARKET_TICK_MS;
  if (!initial) addLog("Used hardware listings refreshed. The warranties remain theoretical.", "system");
}

function updateUnlocks() {
  return;
}

function isCoinUnlocked(coinKey) {
  return !!(state.unlocks && state.unlocks.coins && state.unlocks.coins[coinKey]);
}

function isFeatureUnlocked(featureKey) {
  return !!(state.unlocks && state.unlocks.features && state.unlocks.features[featureKey]);
}

function isRequirementMet(requirement) {
  if (!requirement) return true;
  if (requirement.type === "hashrate") return getInstalledHashrate() >= requirement.value;
  return state.lifetimeEarnings >= requirement.value;
}

function getRequirementProgress(requirement) {
  if (!requirement) return "";
  if (requirement.type === "hashrate") {
    return `${formatNumber(Math.min(getInstalledHashrate(), requirement.value))}/${formatNumber(requirement.value)} HR`;
  }
  return `${formatMoney(Math.min(state.lifetimeEarnings, requirement.value))}/${formatMoney(requirement.value)}`;
}

function formatRequirementText(requirement) {
  if (!requirement) return "Available immediately";
  if (requirement.type === "hashrate") return `Requires ${formatNumber(requirement.value)} HR installed hashrate`;
  return `Requires ${formatMoney(requirement.value)} lifetime earnings`;
}

function canUnlockCoin(coinKey) {
  const coin = COIN_DEFS[coinKey];
  return !!coin && !isCoinUnlocked(coinKey) && isRequirementMet(coin.unlockRequirement);
}

function canUnlockFeature(featureKey) {
  const feature = FEATURE_UNLOCK_DEFS[featureKey];
  return !!feature && !isFeatureUnlocked(featureKey) && isRequirementMet(feature.requirement);
}

function getFacilityByKey(facilityKey) {
  return FACILITY_DEFS.find((facility) => facility.key === facilityKey);
}

function getSiteById(siteId) {
  return state.sites.find((site) => site.id === siteId);
}

function getOwnedFacilityKeys() {
  return state.sites.map((site) => site.facilityKey);
}

function isFacilityUnlockedForPurchase(facility) {
  const owned = getOwnedFacilityKeys();
  const prerequisitesMet = (facility.prerequisiteFacilityKeys || []).every((key) => owned.includes(key));
  return prerequisitesMet && state.lifetimeEarnings >= facility.earningsRequirement;
}

function getAvailableFacilityPurchases() {
  const owned = getOwnedFacilityKeys();
  return FACILITY_DEFS.filter((facility) => !owned.includes(facility.key) && facility.upgradeCost > 0);
}

function getNextFacilityToBuy() {
  return getAvailableFacilityPurchases().find((facility) => isFacilityUnlockedForPurchase(facility)) || getAvailableFacilityPurchases()[0] || null;
}

function getSiteFacility(siteId) {
  const site = getSiteById(siteId);
  return site ? getFacilityByKey(site.facilityKey) : FACILITY_DEFS[0];
}

function getSiteMachineCount(siteId) {
  return state.machines.filter((machine) => machine.siteId === siteId).length;
}

function getSitesWithCapacity() {
  return state.sites.filter((site) => getSiteMachineCount(site.id) < getFacilityByKey(site.facilityKey).maxMachines);
}

function getHighestOwnedFacilityTier() {
  return Math.max(...state.sites.map((site) => FACILITY_DEFS.findIndex((facility) => facility.key === site.facilityKey)), 0);
}

function getTotalPowerDraw() {
  return state.sites.reduce((total, site) => total + getSitePowerDraw(site.id), 0);
}

function getSitePowerDraw(siteId) {
  return state.machines.filter((machine) => machine.siteId === siteId).reduce((total, machine) => {
    const machineDef = MACHINE_DEFS[machine.type];
    const machinePower = machine.status === "mining" ? machineDef.basePower : machineDef.basePower * 0.25;
    const gpuPower = getActiveMachineGpus(machine)
      .reduce((sum, gpu) => sum + (machine.status === "mining" ? getDisplayedGpuPower(gpu) : getDisplayedGpuPower(gpu) * 0.12), 0);
    const componentPower = getActiveComponents(machine)
      .reduce((sum, component) => sum + (machine.status === "mining" ? getDisplayedComponentPower(component) : getDisplayedComponentPower(component) * 0.15), 0);
    return total + machinePower + gpuPower + componentPower;
  }, 0);
}

function getSiteProjectedPowerDraw(siteId) {
  return state.machines
    .filter((machine) => machine.siteId === siteId)
    .reduce((total, machine) => total + getMachinePower(machine), 0);
}

function getSiteExternalPowerCapacity(siteId) {
  const site = getSiteById(siteId);
  if (!site) return 0;
  return EXTERNAL_POWER_DEFS.reduce((sum, item) => sum + item.capacityWatts * (site.externalPower[item.key] || 0), 0);
}

function getSitePowerLimit(siteId) {
  const facility = getSiteFacility(siteId);
  return (facility ? facility.powerCapacity : 0) + getSiteExternalPowerCapacity(siteId);
}

function isSiteOverloaded(siteId) {
  return getSiteProjectedPowerDraw(siteId) > getSitePowerLimit(siteId);
}

function getInstalledHashrate() {
  return state.machines.reduce((total, machine) => total + getActiveMachineGpus(machine)
    .reduce((sum, gpu) => sum + getDisplayedGpuHashrate(gpu), 0), 0);
}

function getPowerCostPerTick() {
  return state.sites.reduce((total, site) => total + getSitePowerCostPerTick(site.id), 0);
}

function getSolarOffset() {
  return state.sites.reduce((total, site) => total + getSiteSolarOffset(site.id), 0);
}

function getNetGridPowerDraw() {
  return state.sites.reduce((total, site) => total + getSiteNetGridPowerDraw(site.id), 0);
}

function getSiteSolarOffset(siteId) {
  const site = getSiteById(siteId);
  const facility = getSiteFacility(siteId);
  if (!site || !facility) return 0;
  return SOLAR_DEFS.reduce((total, solar) => total + solar.offsetWatts * (site.solar[solar.key] || 0), 0) * facility.solarEfficiency;
}

function getSiteNetGridPowerDraw(siteId) {
  return Math.max(0, getSitePowerDraw(siteId) - getSiteSolarOffset(siteId));
}

function getSitePowerCostPerTick(siteId) {
  const facility = getSiteFacility(siteId);
  const baseRate = state.meta.powerRatePerKwTick * ((facility && facility.powerRateModifier) || 1);
  return (getSiteNetGridPowerDraw(siteId) / 1000) * baseRate;
}

function hasFreeGpuSlot() {
  return state.machines.some((machine) => machine.installedGPUs.length < getMachineSlotCapacity(machine));
}

function getAvailableInstallSlots() {
  const slots = [];
  state.machines.forEach((machine) => {
    const totalSlots = getMachineSlotCapacity(machine);
    for (let slotIndex = machine.installedGPUs.length; slotIndex < totalSlots; slotIndex += 1) {
      slots.push({
        machineId: machine.id,
        slotNumber: slotIndex + 1,
        label: `${MACHINE_DEFS[machine.type].name} Slot ${slotIndex + 1}`
      });
    }
  });
  return slots;
}

function getAvailableComponentTargets(category) {
  const targets = [];
  state.machines.forEach((machine) => {
    getComponentSlots(machine, category).forEach((component, slotIndex) => {
      const occupancy = !component ? "empty" : component.dead ? "dead" : component.name;
      targets.push({
        machineId: machine.id,
        slotIndex,
        label: `${MACHINE_DEFS[machine.type].name} ${formatComponentCategory(category)} ${slotIndex + 1} (${occupancy})`
      });
    });
  });
  return targets;
}

function countRemovableGpus(machine) {
  return machine.installedGPUs.filter((gpu) => !gpu.dead).length;
}

function formatComponentCategory(category) {
  if (category === "mainboard") return "Mainboard";
  if (category === "cpu") return "CPU";
  if (category === "psu") return "PSU";
  return "RAM";
}

function getComponentGroupSummary(machine, category) {
  const slots = getComponentSlots(machine, category);
  const installed = slots.filter((component) => !!component).length;
  const workingComponents = slots.filter((component) => component && !component.dead && component.durability > 0);
  const working = workingComponents.length;
  const dead = slots.filter((component) => component && component.dead).length;
  const total = slots.length;
  const parts = [`${working}/${total} live`];
  if (installed < total) parts.push(`${total - installed} empty`);
  if (dead) parts.push(`${dead} failed`);
  if (workingComponents.length) {
    const totalEfficiency = workingComponents.reduce((sum, component) => sum + getDisplayedComponentEfficiency(component), 0);
    const totalPower = workingComponents.reduce((sum, component) => sum + getDisplayedComponentPower(component), 0);
    parts.push(`Eff ${totalEfficiency.toFixed(2)}x`);
    parts.push(`Draw ${formatNumber(totalPower)} W`);
    if (category === "psu") {
      const totalCapacity = workingComponents.reduce((sum, component) => sum + getDisplayedPsuCapacity(component), 0);
      parts.push(`Cap ${formatNumber(totalCapacity)} W`);
    }
  }
  return parts.join(", ");
}

function getGpuGroupSummary(machine) {
  const totalSlots = getMachineSlotCapacity(machine);
  const active = getActiveMachineGpus(machine).length;
  const installed = machine.installedGPUs.length;
  const dead = machine.installedGPUs.filter((gpu) => gpu.dead).length;
  const parts = [`${active}/${totalSlots} live`];
  if (installed < totalSlots) parts.push(`${totalSlots - installed} empty`);
  if (dead) parts.push(`${dead} failed`);
  const totalHashrate = getActiveMachineGpus(machine).reduce((sum, gpu) => sum + getDisplayedGpuHashrate(gpu), 0);
  const totalPower = getActiveMachineGpus(machine).reduce((sum, gpu) => sum + getDisplayedGpuPower(gpu), 0);
  parts.push(`${formatNumber(totalHashrate)} HR`);
  parts.push(`${formatNumber(totalPower)} W`);
  return parts.join(", ");
}

function getCoolingGroupSummary(machine) {
  const cooling = getCoolingDef(machine.coolingLevel);
  const durabilityText = machine.coolingLevel === "stock"
    ? "Factory"
    : `${formatPercent(getCoolingDurabilityRatio(machine))}${machine.coolingFailed ? " failed" : ""}`;
  return `${cooling.name}, ${formatNumber(cooling.powerDraw)} W, ${durabilityText}`;
}

function getShopComponentGroupSummary(sectionKey, category) {
  if (sectionKey === "components") {
    if (category === "gpu") {
      return `${Object.keys(GPU_DEFS).length} models`;
    }
    return `${Object.keys(COMPONENT_DEFS[category] || {}).length} models`;
  }

  if (sectionKey === "spareComponents") {
    if (category === "gpu") {
      const count = state.spareGpus.length;
      const totalPower = state.spareGpus.reduce((sum, gpu) => sum + gpu.powerDraw, 0);
      return count ? `${count} stored, ${formatNumber(totalPower)} W draw` : "No stored GPUs";
    }
    const components = state.spareComponents.filter((component) => component.category === category);
    const totalPower = components.reduce((sum, component) => sum + component.powerDraw, 0);
    return components.length ? `${components.length} stored, ${formatNumber(totalPower)} W draw` : "No stored parts";
  }

  return "";
}

function getPsuSlotLabel(machine, slotIndex) {
  if (slotIndex === 0) return "Onboard PSU 1";
  let runningIndex = 1;
  for (let bayIndex = 0; bayIndex < (machine.psuBays || []).length; bayIndex++) {
    const bayKey = machine.psuBays[bayIndex];
    const bayDef = PSU_BAY_DEFS[bayKey];
    if (!bayDef) continue;
    if (slotIndex < runningIndex + bayDef.addedSlots) {
      return `${bayDef.name} ${bayIndex + 1} Slot ${slotIndex - runningIndex + 1}`;
    }
    runningIndex += bayDef.addedSlots;
  }
  return `PSU Slot ${slotIndex + 1}`;
}

function getPsuBaySlotRange(machine, bayIndex) {
  let start = 1;
  for (let index = 0; index < bayIndex; index++) {
    const previousBay = PSU_BAY_DEFS[machine.psuBays[index]];
    if (previousBay) start += previousBay.addedSlots;
  }
  const bayDef = PSU_BAY_DEFS[machine.psuBays[bayIndex]];
  const addedSlots = bayDef ? bayDef.addedSlots : 0;
  return { start, end: start + addedSlots - 1 };
}

function canRemovePsuBay(machine, bayIndex) {
  if (!machine || bayIndex < 0 || bayIndex >= (machine.psuBays || []).length) return false;
  const range = getPsuBaySlotRange(machine, bayIndex);
  for (let slotIndex = range.start; slotIndex <= range.end; slotIndex++) {
    if (machine.components.psu[slotIndex]) return false;
  }
  return true;
}

function renderPsuSlotChip(machine, component, slotIndex) {
  const overclockUnlocked = isFeatureUnlocked("overclocking");
  return `
    <div class="gpu-chip ${component && component.dead ? "is-dead" : ""}">
      <div>
        <strong>${getPsuSlotLabel(machine, slotIndex)}: ${component ? component.name : "Missing"}</strong>
        <div class="muted" ${component ? `data-component-meta="${machine.id}:psu:${slotIndex}"` : ""}>${component ? `${component.used ? "Used" : "New"} | Eff. ${getDisplayedComponentEfficiency(component).toFixed(2)}x | Durability ${getDurabilityHtml(component)} | ${formatNumber(getDisplayedComponentPower(component))} W | Cap ${formatNumber(getDisplayedPsuCapacity(component))} W | OC ${getPartOverclockPct(component)}% | Faults ${component.faultCount || 0}` : "Machine cannot mine without this component."}</div>
      </div>
      ${component
        ? component.dead
          ? `<button class="button danger" data-action="remove-dead-component" data-machine="${machine.id}" data-category="psu" data-slot="${slotIndex}">Remove</button>`
          : `<div class="market-actions">
              ${overclockUnlocked ? `<input class="cheat-input" type="range" min="0" max="100" step="5" value="${getPartOverclockPct(component)}" data-action="set-component-oc" data-machine="${machine.id}" data-category="psu" data-slot="${slotIndex}">` : `<span class="muted">OC locked</span>`}
              <button class="button secondary" data-action="remove-component" data-machine="${machine.id}" data-category="psu" data-slot="${slotIndex}">Uninstall</button>
            </div>`
        : `<button class="button success" data-action="install-component-slot" data-machine="${machine.id}" data-category="psu" data-slot="${slotIndex}">Install</button>`}
    </div>
  `;
}

function renderPsuBayLayout(machine, remainingBayCapacity) {
  const onboardSlot = getComponentSlots(machine, "psu")[0] || null;
  const onboardBlock = `
    <div class="component-bay">
      <div class="component-bay-head">
        <div>
          <strong>Onboard PSU Bay</strong>
          <div class="muted">Built-in single PSU position.</div>
        </div>
        <span class="muted">Fixed</span>
      </div>
      <div class="machine-gpu-list">
        ${renderPsuSlotChip(machine, onboardSlot, 0)}
      </div>
    </div>
  `;

  const bayBlocks = (machine.psuBays || []).map((bayKey, index) => {
    const bayDef = PSU_BAY_DEFS[bayKey];
    const removable = canRemovePsuBay(machine, index);
    const range = getPsuBaySlotRange(machine, index);
    const slotCards = [];
    for (let slotIndex = range.start; slotIndex <= range.end; slotIndex++) {
      slotCards.push(renderPsuSlotChip(machine, machine.components.psu[slotIndex] || null, slotIndex));
    }
    return `
      <div class="component-bay">
        <div class="component-bay-head">
          <div>
            <strong>${bayDef.name} ${index + 1}</strong>
            <div class="muted">${bayDef.addedSlots} PSU slots via expansion bay.</div>
          </div>
          <button class="button secondary" data-action="remove-psu-bay" data-machine="${machine.id}" data-bay-index="${index}" ${removable ? "" : "disabled"}>Remove Bay</button>
        </div>
        <div class="machine-gpu-list">
          ${slotCards.join("")}
        </div>
      </div>
    `;
  }).join("");

  const emptyBayBlocks = Array.from({ length: remainingBayCapacity }, (_, index) => `
    <div class="component-bay is-unpurchased">
      <div class="component-bay-head">
        <div>
          <strong>Expansion Bay ${index + 1}</strong>
          <div class="muted">Available for PSU bay upgrades from the Components shop.</div>
        </div>
        <span class="muted">Shop upgrade</span>
      </div>
    </div>
  `).join("");

  return `${onboardBlock}${bayBlocks}${emptyBayBlocks}`;
}

function renderGpuSlotChip(machine, gpu, slotIndex) {
  const overclockUnlocked = isFeatureUnlocked("overclocking");
  return `
    <div class="gpu-chip ${gpu && gpu.dead ? "is-dead" : ""}">
      <div>
        <strong>${gpu ? gpu.name : `Empty Slot ${slotIndex + 1}`}</strong>
        <div class="muted" ${gpu ? `data-gpu-meta="${machine.id}:${gpu.id}"` : ""}>${gpu ? `${gpu.used ? "Used" : "New"} | Eff. ${getDisplayedGpuEfficiency(gpu).toFixed(2)}x | Durability ${getDurabilityHtml(gpu)} | ${formatNumber(getDisplayedGpuPower(gpu))} W | ${formatNumber(getDisplayedGpuHashrate(gpu))} HR | OC ${getPartOverclockPct(gpu)}% | Faults ${gpu.faultCount || 0}` : "Ready for another GPU and a slightly worse power bill."}</div>
      </div>
      ${gpu
        ? gpu.dead
          ? `<button class="button danger" data-action="remove-dead-gpu" data-machine="${machine.id}" data-gpu="${gpu.id}">Remove</button>`
          : `<div class="cheat-actions">
              ${overclockUnlocked ? `<input class="cheat-input" type="range" min="0" max="100" step="5" value="${getPartOverclockPct(gpu)}" data-action="set-gpu-oc" data-machine="${machine.id}" data-gpu="${gpu.id}">` : `<span class="muted">OC locked</span>`}
              <button class="button secondary" data-action="remove-gpu" data-machine="${machine.id}" data-gpu="${gpu.id}">Uninstall</button>
            </div>`
        : `<button class="button success" data-action="install-gpu-slot" data-machine="${machine.id}">Install</button>`}
    </div>
  `;
}

function renderCoolingChip(machine, coolingUnlocked, nextCooling, nextCoolingCost) {
  const cooling = getCoolingDef(machine.coolingLevel);
  const durabilityText = machine.coolingLevel === "stock"
    ? "Factory"
    : `${formatPercent(getCoolingDurabilityRatio(machine))}${machine.coolingFailed ? " failed" : ""}`;
  return `
    <div class="gpu-chip ${machine.coolingFailed ? "is-dead" : ""}">
      <div>
        <strong>${cooling.name}</strong>
        <div class="muted">Wear reduction ${(getEffectiveCooling(machine).wearReduction * 100).toFixed(0)}% | Draw ${formatNumber(cooling.powerDraw)} W | Durability ${durabilityText}</div>
      </div>
      <div class="market-actions">
        <button class="button secondary" data-action="buy-cooling" data-machine="${machine.id}" ${!coolingUnlocked || !nextCooling || state.cash < nextCoolingCost ? "disabled" : ""}>${coolingUnlocked ? (nextCooling ? `Upgrade (${formatMoney(nextCoolingCost)})` : "Maxed") : "Cooling Locked"}</button>
        <button class="button secondary" data-action="remove-cooling" data-machine="${machine.id}" ${!coolingUnlocked || machine.coolingLevel === "stock" ? "disabled" : ""}>Remove</button>
      </div>
    </div>
  `;
}

function renderGpuBayLayout(machine, def, expansionCost, canExpand) {
  const totalSlots = getMachineSlotCapacity(machine);
  const installedBySlot = Array.from({ length: totalSlots }, (_, index) => machine.installedGPUs[index] || null);
  const onboardSlots = installedBySlot.slice(0, def.gpuSlots);
  const onboardBlock = `
    <div class="component-bay">
      <div class="component-bay-head">
        <div>
          <strong>Onboard GPU Bays</strong>
          <div class="muted">${def.gpuSlots} built-in GPU slot${def.gpuSlots === 1 ? "" : "s"}.</div>
        </div>
        <span class="muted">Fixed</span>
      </div>
      <div class="machine-gpu-list">
        ${onboardSlots.map((gpu, slotIndex) => renderGpuSlotChip(machine, gpu, slotIndex)).join("")}
      </div>
    </div>
  `;

  const purchasedExpansionBlocks = Array.from({ length: machine.extraSlots || 0 }, (_, index) => {
    const slotIndex = def.gpuSlots + index;
    return `
      <div class="component-bay">
        <div class="component-bay-head">
          <div>
            <strong>GPU Expansion Bay ${index + 1}</strong>
            <div class="muted">Adds one extra GPU slot beyond the onboard chassis.</div>
          </div>
          <span class="muted">Installed</span>
        </div>
        <div class="machine-gpu-list">
          ${renderGpuSlotChip(machine, installedBySlot[slotIndex] || null, slotIndex)}
        </div>
      </div>
    `;
  }).join("");

  const unpurchasedExpansionBlocks = Array.from({ length: Math.max(0, def.maxExpansionSlots - (machine.extraSlots || 0)) }, (_, index) => `
    <div class="component-bay is-unpurchased">
      <div class="component-bay-head">
        <div>
          <strong>GPU Expansion Bay ${index + 1 + (machine.extraSlots || 0)}</strong>
          <div class="muted">Requires an expansion card to unlock this extra GPU position.</div>
        </div>
        <button class="button secondary" data-action="buy-expansion" data-machine="${machine.id}" ${(!canExpand || index > 0 || state.cash < expansionCost) ? "disabled" : ""}>Add Slot (${formatMoney(expansionCost)})</button>
      </div>
    </div>
  `).join("");

  return `${onboardBlock}${purchasedExpansionBlocks}${unpurchasedExpansionBlocks}`;
}

function canRepairMachine(machine) {
  return machine.status === "failed" && hasMinimumCoreComponents(machine);
}

function getSpareComponentsByCategory(category) {
  return state.spareComponents.filter((component) => component.category === category);
}

function getMachineSlotCapacity(machine) {
  return machine.gpuSlots + (machine.extraSlots || 0);
}

function getExpansionSlotCost(machine) {
  const def = MACHINE_DEFS[machine.type];
  return Math.round(def.expansionSlotCost * (1 + (machine.extraSlots || 0) * 0.6));
}

function getPsuBayCost(machine, bayKey) {
  const bayDef = PSU_BAY_DEFS[bayKey];
  if (!bayDef) return 0;
  return bayDef.price;
}

function getAvailablePsuBayOptions(machine) {
  const def = MACHINE_DEFS[machine.type];
  if ((machine.psuBays || []).length >= (def.maxPsuBayCount || 0)) return [];
  return (def.allowedPsuBaySizes || []).map((key) => PSU_BAY_DEFS[key]).filter((entry) => !!entry);
}

function getGpuDurabilityModifier(gpu) {
  const ratio = gpu.durability / gpu.maxDurability;
  return clamp(0.45 + ratio * 0.65, 0.25, 1.1);
}

function buyMachine(typeKey, siteId = null) {
  const def = MACHINE_DEFS[typeKey];
  const targetSite = siteId ? getSiteById(siteId) : getSitesWithCapacity()[0];
  if (!targetSite) {
    addLog(`No room for ${def.name}. Every owned facility is out of floor space and excuses.`, "warn");
    return;
  }
  if (state.cash < def.price) return;
  state.cash -= def.price;
  const machine = createMachine(typeKey);
  machine.siteId = targetSite.id;
  state.machines.push(machine);
  addLog(`Purchased ${def.name} for ${getFacilityByKey(targetSite.facilityKey).name}. Capital expenditure has entered the chat.`, "gain");
  renderAll();
}

function buyGpu(gpuKey, usedOfferId = null, targetMachineId = null) {
  const availableSlots = getAvailableInstallSlots();
  const selectedSlot = targetMachineId
    ? availableSlots.find((slot) => slot.machineId === targetMachineId)
    : availableSlots[0];

  if (!selectedSlot) {
    addLog("No free GPU slot available. Buy more chassis before more silicon.", "warn");
    renderShop();
    renderUsedMarket();
    renderEventLog();
    return;
  }

  const targetMachine = state.machines.find((machine) => machine.id === selectedSlot.machineId);
  if (!targetMachine) return;

  let gpu;
  let price;

  if (usedOfferId) {
    const offer = state.usedMarketOffers.find((entry) => entry.id === usedOfferId);
    if (!offer) return;
    price = offer.price;
    if (state.cash < price) return;
    gpu = createGpuInstance(offer.gpuKey, true, offer.durability);
    state.usedMarketOffers = state.usedMarketOffers.filter((entry) => entry.id !== usedOfferId);
    addLog(`Bought used ${gpu.name} for ${formatMoney(price)}. It smells faintly of bankruptcy.`, "gain");
  } else {
    const def = GPU_DEFS[gpuKey];
    price = def.price;
    if (state.cash < price) return;
    gpu = createGpuInstance(gpuKey, false);
    addLog(`Bought new ${gpu.name} for ${formatMoney(price)}. Fresh silicon, fresh denial.`, "gain");
  }

  state.cash -= price;
  targetMachine.installedGPUs.push(gpu);
  targetMachine.missingGpuFailure = false;
  updateMachineStatus(targetMachine);
  renderAll();
}

function buyComponent(componentKey, targetMachineId, slotIndex, usedOfferId = null) {
  const def = getComponentDef(componentKey);
  const targetMachine = state.machines.find((machine) => machine.id === targetMachineId);
  if (!def || !targetMachine) return;

  let component;
  let price;
  if (usedOfferId) {
    const offer = state.usedMarketOffers.find((entry) => entry.id === usedOfferId);
    if (!offer) return;
    price = offer.price;
    if (state.cash < price) return;
    component = createComponentInstance(offer.componentKey, true, offer.durability);
    state.usedMarketOffers = state.usedMarketOffers.filter((entry) => entry.id !== usedOfferId);
    addLog(`Bought used ${component.name} for ${formatMoney(price)}. It arrived wrapped in forum posts.`, "gain");
  } else {
    price = def.price;
    if (state.cash < price) return;
    component = createComponentInstance(componentKey, false);
    addLog(`Bought ${component.name} for ${formatMoney(price)}. Procurement claims this was sensible.`, "gain");
  }

  state.cash -= price;
  const normalizedSlotIndex = def.category === "mainboard" ? 0 : Number(slotIndex) || 0;
  const replaced = getComponentSlots(targetMachine, def.category)[normalizedSlotIndex];
  if (replaced) {
    if (replaced.dead) {
      addLog(`Replaced dead ${replaced.name} in ${MACHINE_DEFS[targetMachine.type].name}.`, "system");
    } else {
      state.spareComponents.push(replaced);
      addLog(`Moved ${replaced.name} from ${MACHINE_DEFS[targetMachine.type].name} into storage.`, "system");
    }
  }
  setComponentSlot(targetMachine, def.category, normalizedSlotIndex, component);
  updateMachineStatus(targetMachine);
  renderAll();
}

function buyComponentToStorage(componentKey, usedOfferId = null) {
  const def = getComponentDef(componentKey);
  if (!def) return;

  let component;
  let price;
  if (usedOfferId) {
    const offer = state.usedMarketOffers.find((entry) => entry.id === usedOfferId);
    if (!offer) return;
    price = offer.price;
    if (state.cash < price) return;
    component = createComponentInstance(offer.componentKey, true, offer.durability);
    state.usedMarketOffers = state.usedMarketOffers.filter((entry) => entry.id !== usedOfferId);
    addLog(`Bought used ${component.name} for ${formatMoney(price)} and placed it into storage. Hoarding is now operational.`, "gain");
  } else {
    price = def.price;
    if (state.cash < price) return;
    component = createComponentInstance(componentKey, false);
    addLog(`Bought ${component.name} for ${formatMoney(price)} and placed it into storage. Future maintenance has a head start.`, "gain");
  }

  state.cash -= price;
  state.spareComponents.push(component);
  renderAll();
}

function buyFacilityUpgrade() {
  return;
}

function buyFacilitySite(facilityKey) {
  const facility = getFacilityByKey(facilityKey);
  if (!facility) return;
  if (!isFacilityUnlockedForPurchase(facility) || state.cash < facility.upgradeCost) return;
  state.cash -= facility.upgradeCost;
  state.sites.push(createSite(facility.key));
  addLog(`Opened ${facility.name} as an additional site. The electric meter has become a stakeholder.`, "gain");
  renderAll();
}

function buySolar(solarKey, siteId) {
  const def = SOLAR_DEFS.find((entry) => entry.key === solarKey);
  const site = getSiteById(siteId);
  const facilityTier = FACILITY_DEFS.findIndex((facility) => facility.key === (site ? site.facilityKey : null));
  const facility = getSiteFacility(siteId);
  if (!def || !site) return;
  if (facilityTier < def.facilityTierRequired || !(facility && facility.solarAllowed) || state.cash < def.price) return;
  state.cash -= def.price;
  site.solar[solarKey] = (site.solar[solarKey] || 0) + 1;
  addLog(`Purchased ${def.name} for ${formatMoney(def.price)} at ${getFacilityByKey(site.facilityKey).name}. The sun is now carrying part of payroll.`, "gain");
  renderAll();
}

function sellCoin(coinKey, amount = null) {
  const available = state.inventory[coinKey];
  const qty = amount !== undefined && amount !== null ? amount : available;
  if (qty <= 0) return;
  const sold = Math.min(available, qty);
  const revenue = sold * state.market[coinKey].price;
  state.inventory[coinKey] -= sold;
  state.cash += revenue;
  state.lifetimeEarnings += revenue;
  addLog(`Sold ${formatCoin(sold)} ${COIN_DEFS[coinKey].name} for ${formatMoney(revenue)}.`, "gain");
  updateUnlocks();
  renderAll();
}

function buyCoin(coinKey, fraction = 0.25) {
  const market = state.market[coinKey];
  if (!market || state.cash <= 0) return;
  const spend = Math.max(0, state.cash * fraction);
  if (spend < 0.01) return;
  const purchased = spend / market.price;
  state.cash -= spend;
  state.inventory[coinKey] += purchased;
  addLog(`Bought ${formatCoin(purchased)} ${COIN_DEFS[coinKey].name} for ${formatMoney(spend)}. Sensible treasury management was not consulted.`, "gain");
  renderAll();
}

function buyCoinByCash(coinKey, cashAmount) {
  const market = state.market[coinKey];
  const spend = clamp(Number(cashAmount) || 0, 0, state.cash);
  if (!market || spend < 0.01) return;
  const purchased = spend / market.price;
  state.cash -= spend;
  state.inventory[coinKey] += purchased;
  addLog(`Bought ${formatCoin(purchased)} ${COIN_DEFS[coinKey].name} for ${formatMoney(spend)}. Manual trade executed.`, "gain");
  renderAll();
}

function sellAllCoins() {
  let soldAnything = false;
  Object.keys(state.inventory).forEach((coinKey) => {
    if (state.inventory[coinKey] > 0.0001) {
      soldAnything = true;
      sellCoin(coinKey);
    }
  });
  if (!soldAnything) {
    addLog("Nothing to sell. Inventory currently contains confidence and dust.", "warn");
    renderEventLog();
  }
}

function sellCoinAmount(coinKey, amount) {
  const qty = clamp(Number(amount) || 0, 0, state.inventory[coinKey]);
  if (qty <= 0) return;
  sellCoin(coinKey, qty);
}

function assignCoin(machineId, coinKey) {
  const machine = state.machines.find((entry) => entry.id === machineId);
  if (!machine || !isCoinUnlocked(coinKey)) return;
  machine.assignedCoin = coinKey;
  updateMachineStatus(machine);
  addLog(`${MACHINE_DEFS[machine.type].name} now mines ${COIN_DEFS[coinKey].name}. Strategy is a generous word.`, "system");
  renderOperation();
  renderEventLog();
}

function unlockCoin(coinKey) {
  if (!canUnlockCoin(coinKey)) return;
  state.unlocks.coins[coinKey] = true;
  addLog(`${COIN_DEFS[coinKey].name} mining rights unlocked. New speculative labor has been approved.`, "gain", coinKey);
  renderAll();
}

function unlockFeature(featureKey) {
  if (!canUnlockFeature(featureKey)) return;
  state.unlocks.features[featureKey] = true;
  addLog(`${FEATURE_UNLOCK_DEFS[featureKey].name} unlocked. Operations has acquired a fresh category of risk.`, "gain", `feature:${featureKey}`);
  renderAll();
}

function moveMachineToSite(machineId, siteId) {
  const machine = state.machines.find((entry) => entry.id === machineId);
  const targetSite = getSiteById(siteId);
  if (!machine || !targetSite || machine.siteId === siteId) return;
  const targetFacility = getFacilityByKey(targetSite.facilityKey);
  if (getSiteMachineCount(siteId) >= targetFacility.maxMachines) {
    addLog(`${targetFacility.name} has no spare machine capacity for that move.`, "warn");
    renderEventLog();
    return;
  }
  machine.siteId = siteId;
  addLog(`${MACHINE_DEFS[machine.type].name} moved to ${targetFacility.name}. Logistics insists this was planned.`, "system");
  renderAll();
}

function repairMachine(machineId) {
  const machine = state.machines.find((entry) => entry.id === machineId);
  if (!machine || !canRepairMachine(machine)) return;
  const def = MACHINE_DEFS[machine.type];
  const cost = def.repairBaseCost * (1 + machine.repairCount * 0.32);
  if (state.cash < cost) return;
  state.cash -= cost;
  const successChance = clamp(0.88 - machine.repairCount * 0.06, 0.48, 0.88);
  machine.status = "repairing";

  if (Math.random() < successChance) {
    machine.health = clamp(machine.health + 24, 35, 95);
    machine.repairCount += 1;
    machine.installedGPUs.forEach((gpu) => {
      if (!gpu.dead && gpu.durability > 0) {
        gpu.durability = clamp(gpu.durability + gpu.maxDurability * 0.14, 1, gpu.maxDurability);
      }
    });
    updateMachineStatus(machine);
    addLog(`${def.name} repaired for ${formatMoney(cost)}. It lives to overheat another day.`, "gain");
  } else {
    machine.repairCount += 1;
    machine.health = clamp(machine.health - 10, 15, 100);
    machine.status = "failed";
    if (Math.random() < 0.25 && machine.installedGPUs.length) {
      const casualty = machine.installedGPUs.find((gpu) => !gpu.dead);
      if (casualty) {
        casualty.dead = true;
        casualty.durability = 0;
        addLog(`${def.name} repair failed for ${formatMoney(cost)} and took ${casualty.name} with it.`, "loss");
      } else {
        addLog(`${def.name} repair failed for ${formatMoney(cost)}. The screwdriver achieved nothing.`, "loss");
      }
    } else {
      addLog(`${def.name} repair failed for ${formatMoney(cost)}. The screwdriver achieved nothing.`, "loss");
    }
  }

  renderAll();
}

function removeDeadGpu(machineId, gpuId) {
  const machine = state.machines.find((entry) => entry.id === machineId);
  if (!machine) return;
  const gpu = machine.installedGPUs.find((entry) => entry.id === gpuId);
  if (!gpu || !gpu.dead) return;
  machine.installedGPUs = machine.installedGPUs.filter((entry) => entry.id !== gpuId);
  updateMachineStatus(machine);
  addLog(`${gpu.name} removed from ${MACHINE_DEFS[machine.type].name}. Accounting calls this tidy-up.`, "system");
  renderAll();
}

function removeComponentToStorage(machineId, category, slotIndex) {
  const machine = state.machines.find((entry) => entry.id === machineId);
  if (!machine) return;
  const normalizedSlotIndex = category === "mainboard" ? 0 : Number(slotIndex) || 0;
  const component = getComponentSlots(machine, category)[normalizedSlotIndex];
  if (!component || component.dead) return;
  setComponentSlot(machine, category, normalizedSlotIndex, null);
  state.spareComponents.push(component);
  updateMachineStatus(machine);
  addLog(`${component.name} uninstalled from ${MACHINE_DEFS[machine.type].name} and moved to storage. The machine immediately became decorative.`, "warn");
  renderAll();
}

function removeDeadComponent(machineId, category, slotIndex) {
  const machine = state.machines.find((entry) => entry.id === machineId);
  if (!machine) return;
  const normalizedSlotIndex = category === "mainboard" ? 0 : Number(slotIndex) || 0;
  const component = getComponentSlots(machine, category)[normalizedSlotIndex];
  if (!component || !component.dead) return;
  setComponentSlot(machine, category, normalizedSlotIndex, null);
  updateMachineStatus(machine);
  addLog(`Dead ${component.name} removed from ${MACHINE_DEFS[machine.type].name}.`, "system");
  renderAll();
}

function removeGpuToStorage(machineId, gpuId) {
  const machine = state.machines.find((entry) => entry.id === machineId);
  if (!machine) return;
  const gpu = machine.installedGPUs.find((entry) => entry.id === gpuId);
  if (!gpu || gpu.dead) return;

  machine.installedGPUs = machine.installedGPUs.filter((entry) => entry.id !== gpuId);
  state.spareGpus.push(gpu);
  if (!getActiveMachineGpus(machine).length) {
    machine.missingGpuFailure = true;
    machine.status = "failed";
    addLog(`${gpu.name} uninstalled from ${MACHINE_DEFS[machine.type].name}. The machine failed because it no longer has a working GPU.`, "warn");
  } else {
    addLog(`${gpu.name} removed from ${MACHINE_DEFS[machine.type].name} and moved to storage.`, "system");
  }
  updateMachineStatus(machine);
  renderAll();
}

function getUsedSaleValue(gpu) {
  const baseValue = gpu.price * (gpu.used ? 0.38 : 0.52);
  const durabilityFactor = clamp(gpu.durability / gpu.maxDurability, 0.15, 1);
  return Math.round(baseValue * durabilityFactor);
}

function sellGpuUsed(machineId, gpuId) {
  const machine = state.machines.find((entry) => entry.id === machineId);
  if (!machine) return;
  const gpu = machine.installedGPUs.find((entry) => entry.id === gpuId);
  if (!gpu || gpu.dead) return;
  if (countRemovableGpus(machine) <= 1) {
    addLog(`${MACHINE_DEFS[machine.type].name} cannot sell its last GPU. One card must remain to pretend this is mining.`, "warn");
    renderEventLog();
    return;
  }

  const saleValue = getUsedSaleValue(gpu);
  machine.installedGPUs = machine.installedGPUs.filter((entry) => entry.id !== gpuId);
  state.cash += saleValue;
  state.lifetimeEarnings += saleValue;
  updateMachineStatus(machine);
  addLog(`Sold ${gpu.name} from ${MACHINE_DEFS[machine.type].name} for ${formatMoney(saleValue)} on the used market.`, "gain");
  updateUnlocks();
  renderAll();
}

function installSpareGpu(gpuId, targetMachineId) {
  const availableSlots = getAvailableInstallSlots();
  const selectedSlot = targetMachineId
    ? availableSlots.find((slot) => slot.machineId === targetMachineId)
    : availableSlots[0];

  if (!selectedSlot) {
    addLog("No free GPU slot available for that spare card.", "warn");
    renderEventLog();
    return;
  }

  const targetMachine = state.machines.find((machine) => machine.id === selectedSlot.machineId);
  if (!targetMachine) return;

  const gpuIndex = state.spareGpus.findIndex((entry) => entry.id === gpuId);
  if (gpuIndex === -1) return;
  const [gpu] = state.spareGpus.splice(gpuIndex, 1);
  targetMachine.installedGPUs.push(gpu);
  targetMachine.missingGpuFailure = false;
  updateMachineStatus(targetMachine);
  addLog(`${gpu.name} installed into ${MACHINE_DEFS[targetMachine.type].name} from storage.`, "gain");
  renderAll();
}

function installSpareComponent(componentId, targetMachineId, slotIndex) {
  const targetMachine = state.machines.find((machine) => machine.id === targetMachineId);
  const componentIndex = state.spareComponents.findIndex((entry) => entry.id === componentId);
  if (!targetMachine || componentIndex === -1) return;
  const [component] = state.spareComponents.splice(componentIndex, 1);
  const normalizedSlotIndex = component.category === "mainboard" ? 0 : Number(slotIndex) || 0;
  const replaced = getComponentSlots(targetMachine, component.category)[normalizedSlotIndex];
  if (replaced && !replaced.dead) state.spareComponents.push(replaced);
  setComponentSlot(targetMachine, component.category, normalizedSlotIndex, component);
  updateMachineStatus(targetMachine);
  addLog(`${component.name} installed into ${MACHINE_DEFS[targetMachine.type].name}.`, "gain");
  renderAll();
}

function promptInstallSpareGpuToMachine(machineId) {
  const machine = state.machines.find((entry) => entry.id === machineId);
  if (!machine) return;
  if (!state.spareGpus.length) {
    addLog("No spare GPUs available to install.", "warn");
    renderEventLog();
    return;
  }
  openSelectionModal(
    `Choose which spare GPU to install into ${MACHINE_DEFS[machine.type].name}.`,
    state.spareGpus.map((gpu) => ({
      value: gpu.id,
      label: `${gpu.name} (${formatPercent(gpu.durability / gpu.maxDurability)}, ${formatNumber(gpu.hashrate)} HR)`
    })),
    (gpuId) => installSpareGpu(gpuId, machineId),
    "No spare GPUs available to install."
  );
}

function promptInstallSpareComponentToMachine(machineId, category, slotIndex) {
  const machine = state.machines.find((entry) => entry.id === machineId);
  const spares = getSpareComponentsByCategory(category);
  if (!machine) return;
  if (!spares.length) {
    addLog(`No spare ${formatComponentCategory(category)} components available to install.`, "warn");
    renderEventLog();
    return;
  }
  openSelectionModal(
    `Choose which spare ${formatComponentCategory(category)} to install into ${MACHINE_DEFS[machine.type].name}.`,
    spares.map((component) => ({
      value: component.id,
      label: `${component.name} (${formatPercent(component.durability / component.maxDurability)}, ${formatNumber(component.powerDraw)} W)`
    })),
    (componentId) => installSpareComponent(componentId, machineId, slotIndex),
    `No spare ${formatComponentCategory(category)} components available to install.`
  );
}

function sellSpareGpu(gpuId) {
  const gpuIndex = state.spareGpus.findIndex((entry) => entry.id === gpuId);
  if (gpuIndex === -1) return;
  const [gpu] = state.spareGpus.splice(gpuIndex, 1);
  const saleValue = getUsedSaleValue(gpu);
  state.cash += saleValue;
  state.lifetimeEarnings += saleValue;
  addLog(`Sold stored ${gpu.name} for ${formatMoney(saleValue)} on the used market.`, "gain");
  updateUnlocks();
  renderAll();
}

function sellSpareComponent(componentId) {
  const componentIndex = state.spareComponents.findIndex((entry) => entry.id === componentId);
  if (componentIndex === -1) return;
  const [component] = state.spareComponents.splice(componentIndex, 1);
  const saleValue = getUsedSaleValue(component);
  state.cash += saleValue;
  state.lifetimeEarnings += saleValue;
  addLog(`Sold stored ${component.name} for ${formatMoney(saleValue)} on the used market.`, "gain");
  updateUnlocks();
  renderAll();
}

function buyExpansionCard(machineId) {
  const machine = state.machines.find((entry) => entry.id === machineId);
  if (!machine) return;

  const def = MACHINE_DEFS[machine.type];
  const extraSlots = machine.extraSlots || 0;
  if (extraSlots >= def.maxExpansionSlots) return;

  const cost = getExpansionSlotCost(machine);
  if (state.cash < cost) return;

  state.cash -= cost;
  machine.extraSlots = extraSlots + 1;
  addLog(`${def.name} gained an expansion card for ${formatMoney(cost)}. Cable management lost the vote.`, "gain");
  renderAll();
}

function getCoolingUpgradeCost(machine, coolingLevel) {
  const machineDef = MACHINE_DEFS[machine.type];
  const scale = 0.72 + machineDef.gpuSlots * 0.22 + machineDef.basePower / 900;
  return Math.round(coolingLevel.price * scale);
}

function buyCoolingUpgrade(machineId) {
  if (!isFeatureUnlocked("cooling")) return;
  const machine = state.machines.find((entry) => entry.id === machineId);
  if (!machine) return;
  const currentIndex = COOLING_LEVELS.findIndex((level) => level.key === machine.coolingLevel);
  const nextLevel = COOLING_LEVELS[currentIndex + 1];
  const upgradeCost = nextLevel ? getCoolingUpgradeCost(machine, nextLevel) : 0;
  if (!nextLevel || state.cash < upgradeCost) return;
  state.cash -= upgradeCost;
  initializeCoolingState(machine, nextLevel.key);
  addLog(`${MACHINE_DEFS[machine.type].name} upgraded to ${nextLevel.name} for ${formatMoney(upgradeCost)}. Fans everywhere felt judged.`, "gain");
  renderAll();
}

function removeCoolingUpgrade(machineId) {
  if (!isFeatureUnlocked("cooling")) return;
  const machine = state.machines.find((entry) => entry.id === machineId);
  if (!machine || machine.coolingLevel === "stock") return;
  const previousCooling = getCoolingDef(machine.coolingLevel);
  initializeCoolingState(machine, "stock");
  addLog(`${previousCooling.name} removed from ${MACHINE_DEFS[machine.type].name}. Thermals have returned to the factory baseline.`, "warn");
  renderAll();
}

function buyCoolingUpgradeToLevel(machineId, levelKey) {
  if (!isFeatureUnlocked("cooling")) return;
  const machine = state.machines.find((entry) => entry.id === machineId);
  const targetLevel = COOLING_LEVELS.find((level) => level.key === levelKey);
  if (!machine || !targetLevel || levelKey === "stock") return;
  const currentIndex = COOLING_LEVELS.findIndex((level) => level.key === machine.coolingLevel);
  const targetIndex = COOLING_LEVELS.findIndex((level) => level.key === levelKey);
  if (targetIndex <= currentIndex) return;
  const cost = getCoolingUpgradeCost(machine, targetLevel);
  if (state.cash < cost) return;
  state.cash -= cost;
  initializeCoolingState(machine, targetLevel.key);
  addLog(`${MACHINE_DEFS[machine.type].name} upgraded to ${targetLevel.name} for ${formatMoney(cost)} from the shop. Thermal optimism improved slightly.`, "gain");
  renderAll();
}

function promptBuyCooling(levelKey) {
  if (!isFeatureUnlocked("cooling")) return;
  const level = COOLING_LEVELS.find((entry) => entry.key === levelKey);
  if (!level || level.key === "stock") return;
  const eligibleMachines = state.machines.filter((machine) => {
    const currentIndex = COOLING_LEVELS.findIndex((entry) => entry.key === machine.coolingLevel);
    const targetIndex = COOLING_LEVELS.findIndex((entry) => entry.key === levelKey);
    return targetIndex > currentIndex;
  });
  if (!eligibleMachines.length) {
    addLog(`No machine can take ${level.name} right now.`, "warn");
    renderEventLog();
    return;
  }
  openSelectionModal(
    `Choose which machine should receive ${level.name}.`,
    eligibleMachines.map((machine) => ({
      value: machine.id,
      label: `${MACHINE_DEFS[machine.type].name} (${getCoolingDef(machine.coolingLevel).name} -> ${level.name}, ${formatMoney(getCoolingUpgradeCost(machine, level))})`
    })),
    (machineId) => buyCoolingUpgradeToLevel(machineId, levelKey),
    "No machine is eligible for that cooling upgrade."
  );
}

function buyPsuBay(machineId, bayKey) {
  const machine = state.machines.find((entry) => entry.id === machineId);
  if (!machine) return;
  const bayDef = PSU_BAY_DEFS[bayKey];
  const def = MACHINE_DEFS[machine.type];
  if (!bayDef || (def.allowedPsuBaySizes || []).indexOf(bayKey) === -1) return;
  if ((machine.psuBays || []).length >= (def.maxPsuBayCount || 0)) return;
  const cost = getPsuBayCost(machine, bayKey);
  if (state.cash < cost) return;
  state.cash -= cost;
  machine.psuBays.push(bayKey);
  ensurePsuSlotArray(machine);
  addLog(`${def.name} gained a ${bayDef.name} for ${formatMoney(cost)}. More cables, more confidence.`, "gain");
  renderAll();
}

function removePsuBay(machineId, bayIndex) {
  const machine = state.machines.find((entry) => entry.id === machineId);
  if (!machine) return;
  const safeIndex = Number(bayIndex);
  if (!Number.isInteger(safeIndex) || !canRemovePsuBay(machine, safeIndex)) {
    addLog("That PSU bay still has hardware installed in it.", "warn");
    renderEventLog();
    return;
  }
  const removed = machine.psuBays.splice(safeIndex, 1)[0];
  ensurePsuSlotArray(machine);
  const bayDef = PSU_BAY_DEFS[removed];
  addLog(`${bayDef ? bayDef.name : "PSU Bay"} removed from ${MACHINE_DEFS[machine.type].name}. Cable density improved slightly.`, "system");
  renderAll();
}

function promptBuyPsuBay(bayKey) {
  const bayDef = PSU_BAY_DEFS[bayKey];
  if (!bayDef) return;
  const eligibleMachines = state.machines.filter((machine) => getAvailablePsuBayOptions(machine).some((option) => option.key === bayKey));
  if (!eligibleMachines.length) {
    addLog(`No owned machine can take a ${bayDef.name} right now.`, "warn");
    renderEventLog();
    return;
  }
  openSelectionModal(
    `Choose which machine should receive ${bayDef.name}.`,
    eligibleMachines.map((machine) => ({
      value: machine.id,
      label: `${MACHINE_DEFS[machine.type].name} (${(machine.psuBays || []).length}/${MACHINE_DEFS[machine.type].maxPsuBayCount} bays used)`
    })),
    (machineId) => buyPsuBay(machineId, bayKey),
    "No owned machine can take that PSU bay upgrade."
  );
}

function buyExternalPower(externalPowerKey, siteId) {
  const def = EXTERNAL_POWER_DEFS.find((entry) => entry.key === externalPowerKey);
  const site = getSiteById(siteId);
  const facilityTier = FACILITY_DEFS.findIndex((facility) => facility.key === (site ? site.facilityKey : null));
  if (!def || !site || facilityTier < def.facilityTierRequired || state.cash < def.price) return;
  state.cash -= def.price;
  site.externalPower[externalPowerKey] = (site.externalPower[externalPowerKey] || 0) + 1;
  addLog(`Installed ${def.name} for ${formatMoney(def.price)} at ${getFacilityByKey(site.facilityKey).name}. Grid negotiations have intensified.`, "gain");
  renderAll();
}

function rebootMachine(machineId) {
  const machine = state.machines.find((entry) => entry.id === machineId);
  if (!machine || machine.status !== "faulted") return;
  machine.faultedPartLabel = null;
  machine.status = "idle";
  updateMachineStatus(machine);
  addLog(`${MACHINE_DEFS[machine.type].name} rebooted successfully. Delusion and uptime restored.`, "gain");
  renderAll();
}

function setHardwareOverclock(machineId, targetType, targetKey, pct, shouldRender = true) {
  if (!isFeatureUnlocked("overclocking")) return;
  const machine = state.machines.find((entry) => entry.id === machineId);
  if (!machine) return;
  const safePct = clamp(Math.round(Number(pct) || 0), 0, 100);
  if (targetType === "gpu") {
    const gpu = machine.installedGPUs.find((entry) => entry.id === targetKey);
    if (!gpu || gpu.dead) return;
    gpu.overclockPct = safePct;
  } else {
    const parts = String(targetKey).split(":");
    const category = parts[0];
    const slotIndex = category === "mainboard" ? 0 : Number(parts[1]) || 0;
    const component = getComponentSlots(machine, category)[slotIndex];
    if (!component || component.dead || (component.category !== "cpu" && component.category !== "ram" && component.category !== "psu")) return;
    component.overclockPct = safePct;
  }
  if (shouldRender) renderAll();
}

function updateMachineLiveStats(machineId) {
  const machine = state.machines.find((entry) => entry.id === machineId);
  if (!machine) return;
  updateMachineStatus(machine);

  const activeGpus = getActiveMachineGpus(machine);
  const totalHashrate = activeGpus.reduce((sum, gpu) => sum + getDisplayedGpuHashrate(gpu), 0);
  const requiredPower = getMachineRequiredPower(machine);
  const totalPsuCapacity = getComponentSlots(machine, "psu")
    .filter((entry) => entry && !entry.dead && entry.durability > 0)
    .reduce((sum, entry) => sum + getDisplayedPsuCapacity(entry), 0);
  const psuOk = hasEnoughPsuCapacity(machine);
  const cooling = getEffectiveCooling(machine);
  const totalSlots = getMachineSlotCapacity(machine);
  const enabledGpuSlots = getEnabledGpuSlotCount(machine);
  const totalRamSlots = getComponentSlotCount(machine, "ram");
  const enabledRamSlots = getEnabledRamSlotCount(machine);
  const site = getSiteById(machine.siteId);
  const siteFacility = site ? getFacilityByKey(site.facilityKey) : null;
  const statusReason = getMachineStatusReason(machine);
  const summaryText = `${siteFacility ? siteFacility.name : "Unknown Site"} | GPU ${enabledGpuSlots}/${totalSlots} live | RAM ${enabledRamSlots}/${totalRamSlots} live | Expansion ${machine.extraSlots || 0}/${MACHINE_DEFS[machine.type].maxExpansionSlots} | Repairs ${machine.repairCount} | ${formatNumber(totalHashrate)} HR | ${machine.status}${machine.faultedPartLabel ? ` | Fault ${machine.faultedPartLabel}` : ""}`;

  const setText = (selector, value) => {
    const el = document.querySelector(selector);
    if (el) el.textContent = value;
  };
  const setHtml = (selector, value) => {
    const el = document.querySelector(selector);
    if (el) el.innerHTML = value;
  };

  setText(`[data-machine-summary='${machineId}']`, summaryText);
  setText(`[data-machine-status='${machineId}']`, machine.status);
  setText(`[data-machine-hashrate='${machineId}']`, formatNumber(totalHashrate));
  setText(`[data-machine-health='${machineId}']`, formatPercent(machine.health / 100));
  setText(`[data-machine-power='${machineId}']`, `${formatNumber(getMachinePower(machine))} W`);
  setText(`[data-machine-psu='${machineId}']`, totalPsuCapacity > 0 ? `${formatNumber(totalPsuCapacity)} W` : "--");
  setText(`[data-machine-load='${machineId}']`, `${formatNumber(requiredPower)} W`);
  setText(`[data-machine-cooling='${machineId}']`, cooling.name);
  setText(`[data-machine-cooling-durability='${machineId}']`, machine.coolingLevel === "stock" ? "Factory" : `${formatPercent(getCoolingDurabilityRatio(machine))}${machine.coolingFailed ? " failed" : ""}`);
  setText(`[data-machine-output='${machineId}']`, `${formatCoin(getEstimatedMachineOutput(machine))}/s`);

  machine.installedGPUs.forEach((gpu) => {
    setHtml(
      `[data-gpu-meta='${machineId}:${gpu.id}']`,
      `${gpu.used ? "Used" : "New"} | Eff. ${getDisplayedGpuEfficiency(gpu).toFixed(2)}x | Durability ${getDurabilityHtml(gpu)} | ${formatNumber(getDisplayedGpuPower(gpu))} W | ${formatNumber(getDisplayedGpuHashrate(gpu))} HR | OC ${getPartOverclockPct(gpu)}% | Faults ${gpu.faultCount || 0}`
    );
  });

  ["mainboard", "cpu", "ram", "psu"].forEach((category) => {
    getComponentSlots(machine, category).forEach((component, slotIndex) => {
      if (!component) return;
      const text = `${component.used ? "Used" : "New"} | Eff. ${getDisplayedComponentEfficiency(component).toFixed(2)}x | Durability ${getDurabilityHtml(component)} | ${formatNumber(getDisplayedComponentPower(component))} W${category === "psu" ? ` | Cap ${formatNumber(getDisplayedPsuCapacity(component))} W` : ""}${(category === "cpu" || category === "ram" || category === "psu") ? ` | OC ${getPartOverclockPct(component)}%` : ""} | Faults ${component.faultCount || 0}`;
      setHtml(`[data-component-meta='${machineId}:${category}:${slotIndex}']`, text);
    });
  });

  const statusEl = document.querySelector(`[data-machine-status='${machineId}']`);
  if (statusEl) {
    statusEl.className = `status-pill status-${machine.status}`;
    statusEl.title = statusReason;
  }

  const loadEl = document.querySelector(`[data-machine-load='${machineId}']`);
  const psuEl = document.querySelector(`[data-machine-psu='${machineId}']`);
  if (loadEl) loadEl.classList.toggle("loss", !psuOk);
  if (psuEl) psuEl.classList.toggle("loss", !psuOk);

  const cardEl = document.querySelector(`[data-machine-card='${machineId}']`);
  if (cardEl) {
    const hasFailedGpu = machine.installedGPUs.some((gpu) => gpu.dead);
    cardEl.classList.toggle("is-failed", machine.status === "failed");
    cardEl.classList.toggle("is-degraded", machine.status !== "failed" && hasFailedGpu);
  }
}

function addLog(message, type = "system", unlockKey = null) {
  state.eventLog.unshift({
    id: `${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    message,
    type,
    createdAt: Date.now(),
    unlockKey
  });
  if (state.eventLog.length > LOG_LIMIT) state.eventLog.length = LOG_LIMIT;
}

function renderAll() {
  applyTheme();
  applyPanelCollapseState();
  renderSummary();
  renderMarket();
  renderOperation();
  renderShop();
  renderUnlocks();
  renderUsedMarket();
  renderEventLog();
  renderCheats();
  applyShopSectionCollapseState();
}

function isOperationControlFocused() {
  const active = document.activeElement;
  return !!active && active.matches && active.matches("[data-action='assign-coin'], [data-action='assign-site'], [data-action='set-gpu-oc'], [data-action='set-component-oc']");
}

function applyTheme() {
  const theme = state.ui.theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", theme);
  if (dom.themeButton) {
    dom.themeButton.textContent = theme === "dark" ? "Light Mode" : "Dark Mode";
  }
  if (dom.versionLabel) {
    dom.versionLabel.textContent = `v${APP_VERSION}`;
  }
}

function getClosestPanel(elementId) {
  const element = document.getElementById(elementId);
  return element ? element.closest(".panel") : null;
}

function getToggleSymbol(collapsed) {
  return collapsed ? "+" : "-";
}

function applyPanelCollapseState() {
  const panelMap = {
    market: getClosestPanel("market-panel"),
    usedMarket: getClosestPanel("used-market-panel"),
    operation: getClosestPanel("operation-panel"),
    shop: getClosestPanel("machine-shop"),
    unlocks: getClosestPanel("unlock-panel"),
    eventLog: getClosestPanel("event-log-panel"),
    cheats: getClosestPanel("cheat-panel")
  };

  Object.entries(panelMap).forEach(([key, panel]) => {
    if (!panel) return;
    panel.classList.toggle("is-collapsed", !!state.ui.collapsedPanels[key]);
    const toggle = panel.querySelector(`[data-action='toggle-panel'][data-panel='${key}']`);
    if (toggle) toggle.textContent = getToggleSymbol(!!state.ui.collapsedPanels[key]);
  });
}

function applyShopSectionCollapseState() {
  document.querySelectorAll("[data-shop-section]").forEach((section) => {
    const key = section.dataset.shopSection;
    const collapsed = !!state.ui.collapsedShopSections[key];
    section.classList.toggle("is-collapsed", collapsed);
    const toggle = section.querySelector(`[data-action='toggle-shop-section'][data-section='${key}']`);
    if (toggle) toggle.textContent = getToggleSymbol(collapsed);
  });
}

function recordPerformanceSnapshot(totalPower, installedHashrate) {
  const history = state.history || (state.history = createInitialPerformanceHistory());
  const now = Date.now();
  const lastPower = history.power.length ? history.power[history.power.length - 1] : null;
  const lastHashrate = history.hashrate.length ? history.hashrate[history.hashrate.length - 1] : null;
  const shouldRecord = !history.lastRecordedAt
    || now - history.lastRecordedAt >= PERFORMANCE_HISTORY_MS
    || lastPower !== totalPower
    || lastHashrate !== installedHashrate;
  if (!shouldRecord) return;
  history.power.push(totalPower);
  history.hashrate.push(installedHashrate);
  if (history.power.length > PERFORMANCE_HISTORY_LIMIT) history.power = history.power.slice(-PERFORMANCE_HISTORY_LIMIT);
  if (history.hashrate.length > PERFORMANCE_HISTORY_LIMIT) history.hashrate = history.hashrate.slice(-PERFORMANCE_HISTORY_LIMIT);
  history.lastRecordedAt = now;
}

function createDualTrendSvg(primaryPoints, secondaryPoints) {
  const width = 240;
  const height = 56;
  const padding = 4;
  const pointCount = Math.max(primaryPoints.length, secondaryPoints.length);
  if (!pointCount) return "--";

  function normalize(points) {
    const max = Math.max(...points, 1);
    return points.map((point, index) => {
      const x = padding + (index / Math.max(pointCount - 1, 1)) * (width - padding * 2);
      const y = height - padding - ((point || 0) / max) * (height - padding * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  }

  return `
    <svg class="sparkline sparkline-dual" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <polyline class="primary" points="${normalize(primaryPoints)}"></polyline>
      <polyline class="secondary" points="${normalize(secondaryPoints)}"></polyline>
    </svg>
  `;
}

function renderSummary() {
  const totalPower = state.sites.reduce((sum, site) => sum + getSiteProjectedPowerDraw(site.id), 0);
  const solarOffset = getSolarOffset();
  const netGridPower = getNetGridPowerDraw();
  const powerCost = getPowerCostPerTick();
  const installedHashrate = getInstalledHashrate();
  const totalCapacity = state.sites.reduce((sum, site) => sum + getFacilityByKey(site.facilityKey).maxMachines, 0);
  const totalPowerCapacity = state.sites.reduce((sum, site) => sum + getSitePowerLimit(site.id), 0);
  const availableCapacity = totalPowerCapacity - totalPower;
  recordPerformanceSnapshot(totalPower, installedHashrate);
  const powerTrend = state.history && state.history.power ? state.history.power : [];
  const hashrateTrend = state.history && state.history.hashrate ? state.history.hashrate : [];

  const cards = [
    ["Cash", formatMoney(state.cash), "Liquid and increasingly spoken for."],
    ["Lifetime Earnings", formatMoney(state.lifetimeEarnings), "Gross revenue, before dignity."],
    ["Installed Hashrate", `${formatNumber(installedHashrate)} HR`, "Total live silicon across all machines."],
    ["Sites", `${state.sites.length}`, `${state.machines.length}/${totalCapacity} machine slots used across all facilities`]
  ];

  dom.summaryBar.innerHTML = cards.map(([label, value, subvalue]) => `
    <div class="summary-card">
      <div class="label">${label}</div>
      <div class="value">${value}</div>
      <div class="subvalue">${subvalue}</div>
    </div>
  `).join("") + `
    <div class="summary-card power-summary-card">
      <div class="label">Power</div>
      <div class="power-summary-layout">
        <div class="power-summary-stats">
          <div class="power-stat"><strong>${formatNumber(totalPower)} W</strong><span>Total draw</span></div>
          <div class="power-stat"><strong>${formatNumber(solarOffset)} W</strong><span>Solar offset</span></div>
          <div class="power-stat"><strong>${formatNumber(netGridPower)} W</strong><span>Grid draw</span></div>
          <div class="power-stat"><strong>${formatMoney(powerCost)}</strong><span>Per billing tick</span></div>
          <div class="power-stat"><strong>${formatNumber(Math.abs(availableCapacity))} W</strong><span>${availableCapacity >= 0 ? "Capacity headroom" : "Over capacity"}</span></div>
          <div class="power-stat"><strong>${formatMoney(state.meta.powerRatePerKwTick)}</strong><span>Base power rate / kW</span></div>
        </div>
        <div class="power-summary-graph">
          <div class="muted">HR vs kW trend</div>
          ${createDualTrendSvg(hashrateTrend.map((value) => value / 100), powerTrend.map((value) => value / 1000))}
          <div class="power-legend">
            <span class="legend-item"><span class="legend-swatch primary"></span>Hashrate (hundreds of HR)</span>
            <span class="legend-item"><span class="legend-swatch secondary"></span>Power (kW)</span>
          </div>
        </div>
      </div>
    </div>
  `;
  renderPanelSummaries();
}

function renderPanelSummaries() {
  const marketValue = Object.keys(state.inventory).reduce((sum, coinKey) => sum + state.inventory[coinKey] * state.market[coinKey].price, 0);
  const marketMoves = Object.values(COIN_DEFS).reduce((totals, coin) => {
    const change = state.market[coin.key].lastChangePct;
    if (change > 0.01) totals.up += 1;
    else if (change < -0.01) totals.down += 1;
    else totals.flat += 1;
    return totals;
  }, { up: 0, down: 0, flat: 0 });
  const failedMachines = state.machines.filter((machine) => machine.status === "failed").length;
  const outageSites = state.sites.filter((site) => isSiteOverloaded(site.id)).length;
  const openSlots = getAvailableInstallSlots().length;
  const latestLog = state.eventLog[0] && state.eventLog[0].message ? state.eventLog[0].message : "No events yet";
  const nextFacility = getNextFacilityToBuy();
  const availableSites = getAvailableFacilityPurchases();
  const availableUnlocks = Object.keys(FEATURE_UNLOCK_DEFS).filter(canUnlockFeature).length + Object.keys(COIN_DEFS).filter(canUnlockCoin).length;
  const unlockedFeatures = Object.keys(FEATURE_UNLOCK_DEFS).filter(isFeatureUnlocked).length;
  const unlockedCoins = Object.keys(COIN_DEFS).filter(isCoinUnlocked).length;

  dom.marketSummary.textContent = `${marketMoves.up} up, ${marketMoves.down} down, ${marketMoves.flat} flat | inv. ${formatMoney(marketValue)}`;
  dom.usedMarketSummary.textContent = `${state.usedMarketOffers.length} offers live`;
  dom.operationSummary.textContent = `${state.machines.length} machines across ${state.sites.length} sites, ${failedMachines} failed${outageSites ? `, ${outageSites} outage` : ""}`;
  dom.shopSummary.textContent = availableSites.length ? `Site options ${availableSites.length}, next ${(nextFacility && nextFacility.name) || availableSites[0].name}` : "All facility sites owned";
  dom.unlockSummary.textContent = `${unlockedFeatures}/${Object.keys(FEATURE_UNLOCK_DEFS).length} features, ${unlockedCoins}/${Object.keys(COIN_DEFS).length} coins${availableUnlocks ? `, ${availableUnlocks} ready` : ""}`;
  dom.eventLogSummary.textContent = latestLog.length > 56 ? `${latestLog.slice(0, 53)}...` : latestLog;
  dom.cheatSummary.textContent = `Cash buttons, speed ${formatNumber(state.cheats.miningSpeedMultiplier || 1)}x`;
}

function getCoinUnlockText(coin, unlocked) {
  if (unlocked) return "Unlocked";
  if (canUnlockCoin(coin.key)) return `Ready to unlock in Unlocks`;
  return formatRequirementText(coin.unlockRequirement);
}

function renderUnlocks() {
  const featureCards = Object.keys(FEATURE_UNLOCK_DEFS).map((key) => {
    const feature = FEATURE_UNLOCK_DEFS[key];
    const unlocked = isFeatureUnlocked(key);
    const ready = canUnlockFeature(key);
    const implementedText = key === "marketManipulation" && unlocked ? "Unlocked, but implementation is still pending." : unlocked ? "Unlocked and operational." : ready ? "Requirement met. Click to unlock." : `${formatRequirementText(feature.requirement)} (${getRequirementProgress(feature.requirement)})`;
    return `
      <div class="shop-card unlock-card ${unlocked ? "is-unlocked" : ""}">
        <div>
          <strong>${feature.name}</strong>
          <div class="muted">${feature.description}</div>
          <div class="muted">${implementedText}</div>
        </div>
        <button class="button ${ready ? "success" : "secondary"}" data-action="unlock-feature" data-feature="${key}" ${ready ? "" : "disabled"}>${unlocked ? "Unlocked" : "Unlock"}</button>
      </div>
    `;
  }).join("");

  const coinCards = Object.values(COIN_DEFS).map((coin) => {
    const unlocked = isCoinUnlocked(coin.key);
    const ready = canUnlockCoin(coin.key);
    const statusText = unlocked ? "Mining unlocked." : ready ? "Requirement met. Click to unlock mining." : `${formatRequirementText(coin.unlockRequirement)} (${getRequirementProgress(coin.unlockRequirement)})`;
    return `
      <div class="shop-card unlock-card ${unlocked ? "is-unlocked" : ""}">
        <div>
          <strong>${coin.name}</strong>
          <div class="muted">${coin.description}</div>
          <div class="muted">${statusText}</div>
        </div>
        <button class="button ${ready ? "success" : "secondary"}" data-action="unlock-coin" data-coin="${coin.key}" ${unlocked || !ready ? "disabled" : ""}>${unlocked ? "Unlocked" : "Unlock"}</button>
      </div>
    `;
  }).join("");

  dom.unlockPanel.innerHTML = `
    <div class="unlock-section">
      <div class="machine-section-title">Features</div>
      <div class="stack compact">${featureCards}</div>
    </div>
    <div class="unlock-section">
      <div class="machine-section-title">Mining Rights</div>
      <div class="stack compact">${coinCards}</div>
    </div>
  `;

  dom.unlockPanel.querySelectorAll("[data-action='unlock-feature']").forEach((button) => {
    button.addEventListener("click", () => unlockFeature(button.dataset.feature));
  });
  dom.unlockPanel.querySelectorAll("[data-action='unlock-coin']").forEach((button) => {
    button.addEventListener("click", () => unlockCoin(button.dataset.coin));
  });
}

function renderMarket() {
  const rows = Object.values(COIN_DEFS)
    .map((coin) => {
      const unlocked = isCoinUnlocked(coin.key);
      const market = state.market[coin.key];
      const owned = state.inventory[coin.key];
      const changeClass = market.lastChangePct >= 0 ? "gain" : "loss";
      const unlockText = getCoinUnlockText(coin, unlocked);
      const recentHistory = state.priceHistory[coin.key] || [];
      const sparkline = createSparklineSvg(recentHistory, market.lastChangePct >= 0);
      const buyEnabled = state.cash >= Math.max(1, market.price * 0.25);
      const volatilityText = state.cheats.showVolatility ? `<div class="coin-meta">Volatility ${(coin.volatility * 100).toFixed(0)} | Trend ${(market.trend * 100).toFixed(1)}%</div>` : "";
      const recentHigh = recentHistory.length ? Math.max(...recentHistory) : market.price;
      const recentLow = recentHistory.length ? Math.min(...recentHistory) : market.price;
      return `
        <div class="coin-row">
          <div class="coin-main">
            <div class="coin-name">${coin.name}</div>
            <div class="coin-meta">${coin.description}</div>
            <div class="coin-meta">${unlockText}</div>
            ${volatilityText}
            <div class="coin-meta">ATH ${formatMoney(market.allTimeHigh || market.price)} | ATL ${formatMoney(market.allTimeLow || market.price)}</div>
            <div class="coin-meta">Recent H ${formatMoney(recentHigh)} | Recent L ${formatMoney(recentLow)}</div>
          </div>
          <div class="coin-stats-grid">
            <div class="coin-stat">
              <div>${formatMoney(market.price)}</div>
              <div class="inline-stat">Current price</div>
            </div>
            <div class="coin-stat">
              <div class="${changeClass}">${formatSignedPercent(market.lastChangePct)}</div>
              <div class="inline-stat">10s move</div>
            </div>
            <div class="coin-stat">
              <div>${formatCoin(owned)}</div>
              <div class="inline-stat">Owned</div>
            </div>
            <div class="coin-stat">
              <div>${sparkline}</div>
              <div class="inline-stat">Recent trend</div>
            </div>
            <div class="coin-stat">
              <div>${formatMoney(owned * market.price)}</div>
              <div class="inline-stat">Inventory value</div>
            </div>
          </div>
          <div class="coin-trade">
            <div class="market-actions">
              <div class="market-action-row">
                <button class="button secondary" data-action="buy-coin-fraction" data-coin="${coin.key}" data-fraction="0.1" ${buyEnabled ? "" : "disabled"}>Buy 10%</button>
                <button class="button secondary" data-action="buy-coin-fraction" data-coin="${coin.key}" data-fraction="0.25" ${buyEnabled ? "" : "disabled"}>Buy 25%</button>
                <input class="cheat-input" type="number" min="0" step="1" placeholder="$ cash" data-action="buy-coin-cash-input" data-coin="${coin.key}">
                <button class="button success" data-action="buy-coin-cash" data-coin="${coin.key}" ${state.cash < 0.01 ? "disabled" : ""}>Buy $</button>
              </div>
              <div class="market-action-row">
                <button class="button secondary" data-action="sell-coin-fraction" data-coin="${coin.key}" data-fraction="0.25" ${owned <= 0.0001 ? "disabled" : ""}>Sell 25%</button>
                <button class="button" data-action="sell-coin" data-coin="${coin.key}" ${owned <= 0.0001 ? "disabled" : ""}>Sell All</button>
                <input class="cheat-input" type="number" min="0" step="0.01" placeholder="coin amt" data-action="sell-coin-amount-input" data-coin="${coin.key}">
                <button class="button danger" data-action="sell-coin-amount" data-coin="${coin.key}" ${owned <= 0.0001 ? "disabled" : ""}>Sell Amt</button>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join("");

  dom.marketPanel.innerHTML = rows || `<div class="empty-state">No market data available.</div>`;

  dom.marketPanel.querySelectorAll("[data-action='buy-coin-fraction']").forEach((button) => {
    button.addEventListener("click", () => buyCoin(button.dataset.coin, Number(button.dataset.fraction)));
  });

  dom.marketPanel.querySelectorAll("[data-action='buy-coin-cash']").forEach((button) => {
    button.addEventListener("click", () => {
      const input = dom.marketPanel.querySelector(`[data-action='buy-coin-cash-input'][data-coin='${button.dataset.coin}']`);
      buyCoinByCash(button.dataset.coin, input ? input.value : 0);
    });
  });

  dom.marketPanel.querySelectorAll("[data-action='sell-coin-fraction']").forEach((button) => {
    button.addEventListener("click", () => sellCoin(button.dataset.coin, state.inventory[button.dataset.coin] * Number(button.dataset.fraction)));
  });

  dom.marketPanel.querySelectorAll("[data-action='sell-coin']").forEach((button) => {
    button.addEventListener("click", () => sellCoin(button.dataset.coin));
  });

  dom.marketPanel.querySelectorAll("[data-action='sell-coin-amount']").forEach((button) => {
    button.addEventListener("click", () => {
      const input = dom.marketPanel.querySelector(`[data-action='sell-coin-amount-input'][data-coin='${button.dataset.coin}']`);
      sellCoinAmount(button.dataset.coin, input ? input.value : 0);
    });
  });
}

function createSparklineSvg(points, positiveTrend) {
  if (!points.length) return "--";

  const width = 120;
  const height = 38;
  const padding = 3;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  const polyline = points.map((point, index) => {
    const x = padding + (index / Math.max(points.length - 1, 1)) * (width - padding * 2);
    const y = height - padding - ((point - min) / range) * (height - padding * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  const stroke = positiveTrend ? "var(--gain)" : "var(--loss)";
  const baselineY = height - padding - ((points[0] - min) / range) * (height - padding * 2);

  return `
    <svg class="sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <line class="baseline" x1="${padding}" y1="${baselineY.toFixed(1)}" x2="${width - padding}" y2="${baselineY.toFixed(1)}"></line>
      <polyline points="${polyline}" stroke="${stroke}"></polyline>
    </svg>
  `;
}

function renderOperation() {
  if (!state.machines.length) {
    dom.operationPanel.innerHTML = `<div class="empty-state">No machines deployed. This is currently just a website.</div>`;
    return;
  }

  dom.operationPanel.innerHTML = state.machines.map((machine) => {
    updateMachineStatus(machine);
    const def = MACHINE_DEFS[machine.type];
    const site = getSiteById(machine.siteId);
    const siteFacility = getFacilityByKey(site.facilityKey);
    const isCollapsed = !!state.ui.collapsedMachines[machine.id];
    const hasFailedGpu = machine.installedGPUs.some((gpu) => gpu.dead);
    const componentGroups = ["mainboard", "cpu", "ram", "psu"].map((category) => ({
      category,
      collapsed: !!state.ui.collapsedComponentGroups[`${machine.id}:${category}`],
      summary: getComponentGroupSummary(machine, category),
      slots: getComponentSlots(machine, category).map((component, slotIndex) => ({ category, component, slotIndex }))
    }));
    const totalPsuCapacity = getComponentSlots(machine, "psu")
      .filter((entry) => entry && !entry.dead && entry.durability > 0)
      .reduce((sum, entry) => sum + getDisplayedPsuCapacity(entry), 0);
    const requiredPower = getMachineRequiredPower(machine);
    const psuOk = hasEnoughPsuCapacity(machine);
  const cooling = getEffectiveCooling(machine);
    const nextCooling = COOLING_LEVELS[COOLING_LEVELS.findIndex((level) => level.key === machine.coolingLevel) + 1] || null;
    const nextCoolingCost = nextCooling ? getCoolingUpgradeCost(machine, nextCooling) : 0;
    const coolingUnlocked = isFeatureUnlocked("cooling");
    const overclockUnlocked = isFeatureUnlocked("overclocking");
    const totalSlots = getMachineSlotCapacity(machine);
    const enabledGpuSlots = getEnabledGpuSlotCount(machine);
    const totalRamSlots = getComponentSlotCount(machine, "ram");
    const enabledRamSlots = getEnabledRamSlotCount(machine);
    const expansionCost = getExpansionSlotCost(machine);
    const repairCost = def.repairBaseCost * (1 + machine.repairCount * 0.32);
    const canExpand = (machine.extraSlots || 0) < def.maxExpansionSlots;
    const activeGpus = getActiveMachineGpus(machine);
    const totalHashrate = activeGpus.reduce((sum, gpu) => sum + getDisplayedGpuHashrate(gpu), 0);
    const statusReason = getMachineStatusReason(machine);
    const gpuGroupCollapsed = !!state.ui.collapsedComponentGroups[`${machine.id}:gpu`];
    const gpuGroupSummary = getGpuGroupSummary(machine);
    const coolingGroupCollapsed = !!state.ui.collapsedComponentGroups[`${machine.id}:cooling`];
    const coolingGroupSummary = getCoolingGroupSummary(machine);
    const remainingBayCapacity = Math.max(0, def.maxPsuBayCount - (machine.psuBays || []).length);
    const coinOptions = Object.values(COIN_DEFS)
      .filter((coin) => isCoinUnlocked(coin.key))
      .map((coin) => `<option value="${coin.key}" ${machine.assignedCoin === coin.key ? "selected" : ""}>${coin.name}</option>`)
      .join("");
    const siteOptions = state.sites.map((entry) => {
      const facility = getFacilityByKey(entry.facilityKey);
      const isCurrent = entry.id === machine.siteId;
      const isFull = !isCurrent && getSiteMachineCount(entry.id) >= facility.maxMachines;
      return `<option value="${entry.id}" ${isCurrent ? "selected" : ""} ${isFull ? "disabled" : ""}>${facility.name} (${getSiteMachineCount(entry.id)}/${facility.maxMachines})</option>`;
    }).join("");

    return `
      <div class="machine-card ${isCollapsed ? "is-collapsed" : ""} ${machine.status === "failed" ? "is-failed" : ""} ${machine.status !== "failed" && hasFailedGpu ? "is-degraded" : ""}" data-machine-card="${machine.id}">
        <div class="machine-head">
          <div>
            <strong>${def.name}</strong>
            <div class="muted" data-machine-summary="${machine.id}">${siteFacility.name} | GPU ${enabledGpuSlots}/${totalSlots} live | RAM ${enabledRamSlots}/${totalRamSlots} live | Expansion ${machine.extraSlots || 0}/${def.maxExpansionSlots} | Repairs ${machine.repairCount} | ${formatNumber(totalHashrate)} HR | ${machine.status}${machine.faultedPartLabel ? ` | Fault ${machine.faultedPartLabel}` : ""}</div>
          </div>
          <div class="cheat-actions">
            <span class="status-pill status-${machine.status}" data-machine-status="${machine.id}" title="${statusReason}">${machine.status}</span>
            <button class="button secondary" aria-label="Toggle machine" title="Toggle machine" data-action="toggle-machine" data-machine="${machine.id}">${isCollapsed ? "▸" : "▾"}</button>
          </div>
        </div>
        <div class="machine-controls">
          <label>
            <span class="muted">Assigned coin</span><br>
            <select data-action="assign-coin" data-machine="${machine.id}">
              ${coinOptions}
            </select>
          </label>
          <label>
            <span class="muted">Site</span><br>
            <select data-action="assign-site" data-machine="${machine.id}">
              ${siteOptions}
            </select>
          </label>
          <button class="button success" data-action="reboot-machine" data-machine="${machine.id}" ${machine.status !== "faulted" ? "disabled" : ""}>Reboot</button>
          <button class="button" data-action="repair-machine" data-machine="${machine.id}" ${!canRepairMachine(machine) || state.cash < repairCost ? "disabled" : ""}>Repair (${formatMoney(repairCost)})</button>
        </div>
        <div class="machine-stats">
          <div>Hashrate <strong data-machine-hashrate="${machine.id}">${formatNumber(totalHashrate)}</strong></div>
          <div>Health <strong data-machine-health="${machine.id}">${formatPercent(machine.health / 100)}</strong></div>
          <div>Power <strong data-machine-power="${machine.id}">${formatNumber(getMachinePower(machine))} W</strong></div>
          <div>PSU <strong class="${psuOk ? "" : "loss"}" data-machine-psu="${machine.id}">${totalPsuCapacity > 0 ? `${formatNumber(totalPsuCapacity)} W` : "--"}</strong></div>
          <div>Load <strong class="${psuOk ? "" : "loss"}" data-machine-load="${machine.id}">${formatNumber(requiredPower)} W</strong></div>
          <div>Cooling <strong data-machine-cooling="${machine.id}">${cooling.name}</strong> <span class="muted" data-machine-cooling-durability="${machine.id}">${machine.coolingLevel === "stock" ? "Factory" : `${formatPercent(getCoolingDurabilityRatio(machine))}${machine.coolingFailed ? " failed" : ""}`}</span></div>
          <div>Output <strong data-machine-output="${machine.id}">${formatCoin(getEstimatedMachineOutput(machine))}/s</strong></div>
        </div>
        <div class="machine-section">
          <div class="machine-section-title">Main Components</div>
          <div class="component-group-list">
            <div class="component-group ${coolingGroupCollapsed ? "is-collapsed" : ""}">
              <div class="component-group-header">
                <div>
                  <strong>Cooling</strong>
                  <div class="muted">${coolingGroupSummary}</div>
                </div>
                <button class="button secondary" aria-label="Toggle cooling group" title="Toggle cooling group" data-action="toggle-component-group" data-machine="${machine.id}" data-category="cooling">${getToggleSymbol(coolingGroupCollapsed)}</button>
              </div>
              <div class="machine-gpu-list component-group-body">
                ${renderCoolingChip(machine, coolingUnlocked, nextCooling, nextCoolingCost)}
              </div>
            </div>
            ${componentGroups.map((group) => `
              <div class="component-group ${group.collapsed ? "is-collapsed" : ""}">
                <div class="component-group-header">
                  <div>
                    <strong>${formatComponentCategory(group.category)}${group.slots.length > 1 ? "s" : ""}</strong>
                    <div class="muted">${group.summary}</div>
                  </div>
                  <button class="button secondary" aria-label="Toggle component group" title="Toggle component group" data-action="toggle-component-group" data-machine="${machine.id}" data-category="${group.category}">${group.collapsed ? "â–¸" : "â–¾"}</button>
                </div>
                <div class="machine-gpu-list component-group-body">
                  ${group.category === "psu"
                    ? renderPsuBayLayout(machine, remainingBayCapacity)
                    : group.slots.map(({ category, component, slotIndex }) => `
                        <div class="gpu-chip ${component && component.dead ? "is-dead" : ""}">
                          <div>
                            <strong>${formatComponentCategory(category)} ${slotIndex + 1}: ${component ? component.name : "Missing"}</strong>
                            <div class="muted" ${component ? `data-component-meta="${machine.id}:${category}:${slotIndex}"` : ""}>${component ? `${component.used ? "Used" : "New"} | Eff. ${getDisplayedComponentEfficiency(component).toFixed(2)}x | Durability ${getDurabilityHtml(component)} | ${formatNumber(getDisplayedComponentPower(component))} W${(category === "cpu" || category === "ram") ? ` | OC ${getPartOverclockPct(component)}%` : ""} | Faults ${component.faultCount || 0}` : "Machine cannot mine without this component."}</div>
                          </div>
                          ${component
                            ? component.dead
                              ? `<button class="button danger" data-action="remove-dead-component" data-machine="${machine.id}" data-category="${category}" data-slot="${slotIndex}">Remove</button>`
                              : `<div class="market-actions">
                                  ${category === "cpu" || category === "ram" ? (overclockUnlocked ? `<input class="cheat-input" type="range" min="0" max="100" step="5" value="${getPartOverclockPct(component)}" data-action="set-component-oc" data-machine="${machine.id}" data-category="${category}" data-slot="${slotIndex}">` : `<span class="muted">OC locked</span>`) : ""}
                                  <button class="button secondary" data-action="remove-component" data-machine="${machine.id}" data-category="${category}" data-slot="${slotIndex}">Uninstall</button>
                                </div>`
                            : `<button class="button success" data-action="install-component-slot" data-machine="${machine.id}" data-category="${category}" data-slot="${slotIndex}">Install</button>`}
                        </div>
                      `).join("")}
                </div>
              </div>
            `).join("")}
          </div>
        </div>
        <div class="machine-section">
          <div class="component-group ${gpuGroupCollapsed ? "is-collapsed" : ""}">
            <div class="component-group-header">
              <div>
                <strong>GPUs</strong>
                <div class="muted">${gpuGroupSummary}</div>
              </div>
              <button class="button secondary" aria-label="Toggle gpu group" title="Toggle gpu group" data-action="toggle-component-group" data-machine="${machine.id}" data-category="gpu">${getToggleSymbol(gpuGroupCollapsed)}</button>
            </div>
            <div class="machine-gpu-list component-group-body">
            ${renderGpuBayLayout(machine, def, expansionCost, canExpand)}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join("");

  dom.operationPanel.querySelectorAll("[data-action='toggle-machine']").forEach((button) => {
    button.textContent = getToggleSymbol(!!state.ui.collapsedMachines[button.dataset.machine]);
  });

  dom.operationPanel.querySelectorAll("[data-action='toggle-component-group']").forEach((button) => {
    button.textContent = getToggleSymbol(!!state.ui.collapsedComponentGroups[`${button.dataset.machine}:${button.dataset.category}`]);
  });

  dom.operationPanel.querySelectorAll("[data-action='assign-coin']").forEach((select) => {
    select.addEventListener("change", () => assignCoin(select.dataset.machine, select.value));
  });

  dom.operationPanel.querySelectorAll("[data-action='assign-site']").forEach((select) => {
    select.addEventListener("change", () => moveMachineToSite(select.dataset.machine, select.value));
  });

  dom.operationPanel.querySelectorAll("[data-action='toggle-machine']").forEach((button) => {
    button.addEventListener("click", () => toggleMachine(button.dataset.machine));
  });

  dom.operationPanel.querySelectorAll("[data-action='toggle-component-group']").forEach((button) => {
    button.addEventListener("click", () => toggleComponentGroup(button.dataset.machine, button.dataset.category));
  });

  dom.operationPanel.querySelectorAll("[data-action='repair-machine']").forEach((button) => {
    button.addEventListener("click", () => repairMachine(button.dataset.machine));
  });

  dom.operationPanel.querySelectorAll("[data-action='buy-expansion']").forEach((button) => {
    button.addEventListener("click", () => buyExpansionCard(button.dataset.machine));
  });

  dom.operationPanel.querySelectorAll("[data-action='buy-cooling']").forEach((button) => {
    button.addEventListener("click", () => buyCoolingUpgrade(button.dataset.machine));
  });

  dom.operationPanel.querySelectorAll("[data-action='remove-cooling']").forEach((button) => {
    button.addEventListener("click", () => removeCoolingUpgrade(button.dataset.machine));
  });

  dom.operationPanel.querySelectorAll("[data-action='reboot-machine']").forEach((button) => {
    button.addEventListener("click", () => rebootMachine(button.dataset.machine));
  });

  dom.operationPanel.querySelectorAll("[data-action='set-gpu-oc']").forEach((input) => {
    input.addEventListener("input", () => {
      setHardwareOverclock(input.dataset.machine, "gpu", input.dataset.gpu, input.value, false);
      updateMachineLiveStats(input.dataset.machine);
      renderSummary();
    });
    input.addEventListener("change", () => setHardwareOverclock(input.dataset.machine, "gpu", input.dataset.gpu, input.value, true));
  });

  dom.operationPanel.querySelectorAll("[data-action='set-component-oc']").forEach((input) => {
    input.addEventListener("input", () => {
      setHardwareOverclock(input.dataset.machine, "component", `${input.dataset.category}:${input.dataset.slot}`, input.value, false);
      updateMachineLiveStats(input.dataset.machine);
      renderSummary();
    });
    input.addEventListener("change", () => setHardwareOverclock(input.dataset.machine, "component", `${input.dataset.category}:${input.dataset.slot}`, input.value, true));
  });

  dom.operationPanel.querySelectorAll("[data-action='remove-dead-gpu']").forEach((button) => {
    button.addEventListener("click", () => removeDeadGpu(button.dataset.machine, button.dataset.gpu));
  });

  dom.operationPanel.querySelectorAll("[data-action='remove-gpu']").forEach((button) => {
    button.addEventListener("click", () => removeGpuToStorage(button.dataset.machine, button.dataset.gpu));
  });

  dom.operationPanel.querySelectorAll("[data-action='remove-component']").forEach((button) => {
    button.addEventListener("click", () => removeComponentToStorage(button.dataset.machine, button.dataset.category, button.dataset.slot));
  });

  dom.operationPanel.querySelectorAll("[data-action='remove-psu-bay']").forEach((button) => {
    button.addEventListener("click", () => removePsuBay(button.dataset.machine, button.dataset.bayIndex));
  });

  dom.operationPanel.querySelectorAll("[data-action='remove-dead-component']").forEach((button) => {
    button.addEventListener("click", () => removeDeadComponent(button.dataset.machine, button.dataset.category, button.dataset.slot));
  });

  dom.operationPanel.querySelectorAll("[data-action='install-gpu-slot']").forEach((button) => {
    button.addEventListener("click", () => promptInstallSpareGpuToMachine(button.dataset.machine));
  });

  dom.operationPanel.querySelectorAll("[data-action='install-component-slot']").forEach((button) => {
    button.addEventListener("click", () => promptInstallSpareComponentToMachine(button.dataset.machine, button.dataset.category, button.dataset.slot));
  });
}

function renderShop() {
  const freeSlotAvailable = hasFreeGpuSlot();
  const sitesWithCapacity = getSitesWithCapacity();
  const coolingUnlocked = isFeatureUnlocked("cooling");
  dom.machineShop.innerHTML = Object.values(MACHINE_DEFS).map((machine) => `
    <div class="shop-card">
      <div>
        <strong>${machine.name}</strong>
        <div class="muted">${machine.description}</div>
        <div class="muted">${machine.gpuSlots} GPU slots | ${formatNumber(machine.basePower)} W base load</div>
        <div class="muted">${machine.componentSlots.cpu} CPU | ${machine.componentSlots.ram} RAM | ${machine.componentSlots.psu} PSU</div>
      </div>
      <div>
        <div><strong>${formatMoney(machine.price)}</strong></div>
        <button class="button" data-action="buy-machine" data-machine="${machine.key}" ${state.cash < machine.price || !sitesWithCapacity.length ? "disabled" : ""}>Buy</button>
      </div>
    </div>
  `).join("");

  dom.componentShop.innerHTML = `
    ${(() => {
      const collapsed = !!state.ui.collapsedShopComponentGroups["components:cooling"];
      return `
      <div class="shop-subsection ${collapsed ? "is-collapsed" : ""}">
        <div class="shop-subsection-header">
          <div>
            <h3>Cooling</h3>
            <div class="muted">${COOLING_LEVELS.length - 1} upgrade tiers</div>
          </div>
          <button class="button secondary" aria-label="Toggle shop cooling group" title="Toggle shop cooling group" data-action="toggle-shop-component-group" data-section="components" data-category="cooling">${getToggleSymbol(collapsed)}</button>
        </div>
        <div class="stack compact shop-subsection-body">
          ${COOLING_LEVELS.filter((level) => level.key !== "stock").map((level) => `
            <div class="shop-card">
              <div>
                <strong>${level.name}</strong>
                <div class="muted">${level.description}</div>
                <div class="muted">Wear reduction ${(level.wearReduction * 100).toFixed(0)}% | Draw ${formatNumber(level.powerDraw)} W</div>
              </div>
              <div>
                <div><strong>${formatMoney(level.price)}</strong></div>
                <button class="button" data-action="buy-cooling-shop" data-cooling="${level.key}" ${!coolingUnlocked ? "disabled" : ""}>${coolingUnlocked ? "Buy" : "Locked"}</button>
              </div>
            </div>
          `).join("")}
          ${!coolingUnlocked ? `<div class="empty-state">Cooling is locked. Unlock it first to buy these upgrades.</div>` : ""}
        </div>
      </div>
      `;
    })()}
    ${(() => {
      const collapsed = !!state.ui.collapsedShopComponentGroups["components:psuBay"];
      return `
      <div class="shop-subsection ${collapsed ? "is-collapsed" : ""}">
        <div class="shop-subsection-header">
          <div>
            <h3>PSU Bays</h3>
            <div class="muted">Expansion bay upgrades for extra PSU mounting points.</div>
          </div>
          <button class="button secondary" aria-label="Toggle shop psu bay group" title="Toggle shop psu bay group" data-action="toggle-shop-component-group" data-section="components" data-category="psuBay">${getToggleSymbol(collapsed)}</button>
        </div>
        <div class="stack compact shop-subsection-body">
          ${Object.values(PSU_BAY_DEFS).map((bayDef) => `
            <div class="shop-card">
              <div>
                <strong>${bayDef.name}</strong>
                <div class="muted">${bayDef.addedSlots} extra PSU slots</div>
                <div class="muted">${bayDef.description}</div>
              </div>
              <div>
                <div><strong>${formatMoney(bayDef.price)}</strong></div>
                <button class="button" data-action="buy-psu-bay-shop" data-bay="${bayDef.key}">Buy</button>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
      `;
    })()}
    ${Object.entries(COMPONENT_DEFS).map(([category, group]) => {
      const collapsed = !!state.ui.collapsedShopComponentGroups[`components:${category}`];
      return `
      <div class="shop-subsection ${collapsed ? "is-collapsed" : ""}">
        <div class="shop-subsection-header">
          <div>
            <h3>${formatComponentCategory(category)}s</h3>
            <div class="muted">${getShopComponentGroupSummary("components", category)}</div>
          </div>
          <button class="button secondary" aria-label="Toggle shop component group" title="Toggle shop component group" data-action="toggle-shop-component-group" data-section="components" data-category="${category}">${getToggleSymbol(collapsed)}</button>
        </div>
        <div class="stack compact shop-subsection-body">
          ${Object.values(group).map((component) => `
            <div class="shop-card">
              <div>
                <strong>${component.name}</strong>
                <div class="muted">${component.category === "psu" ? `Capacity ${formatNumber(component.wattage)} W | Draw ${formatNumber(component.powerDraw)} W` : `${formatNumber(component.powerDraw)} W | Eff. ${component.efficiencyModifier.toFixed(2)}x`}</div>
                <div class="muted">Choose a machine now, or store it for later after clicking buy.</div>
              </div>
              <div>
                <div><strong>${formatMoney(component.price)}</strong></div>
                <button class="button" data-action="buy-component" data-component="${component.key}" ${state.cash < component.price ? "disabled" : ""}>Buy</button>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
      `;
    }).join("")}
    ${(() => {
      const collapsed = !!state.ui.collapsedShopComponentGroups["components:gpu"];
      return `
      <div class="shop-subsection ${collapsed ? "is-collapsed" : ""}">
        <div class="shop-subsection-header">
          <div>
            <h3>GPUs</h3>
            <div class="muted">${getShopComponentGroupSummary("components", "gpu")}</div>
          </div>
          <button class="button secondary" aria-label="Toggle shop gpu group" title="Toggle shop gpu group" data-action="toggle-shop-component-group" data-section="components" data-category="gpu">${getToggleSymbol(collapsed)}</button>
        </div>
        <div class="stack compact shop-subsection-body">
          ${Object.values(GPU_DEFS).map((gpu) => `
            <div class="shop-card">
              <div>
                <strong>${gpu.name}</strong>
                <div class="muted">${formatNumber(gpu.hashrate)} HR | Draw ${formatNumber(gpu.powerDraw)} W | Eff. ${gpu.efficiencyModifier.toFixed(2)}x</div>
                <div class="muted">${freeSlotAvailable ? "Choose an open slot or store it for later after clicking buy." : "Store it for later, or wait for an open GPU slot."}</div>
              </div>
              <div>
                <div><strong>${formatMoney(gpu.price)}</strong></div>
                <button class="button" data-action="buy-gpu" data-gpu="${gpu.key}" ${state.cash < gpu.price ? "disabled" : ""}>Buy</button>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
      `;
    })()}
  `;

  dom.spareComponentShop.innerHTML = `
    ${state.spareComponents.length ? Object.keys(COMPONENT_DEFS).map((category) => {
    const components = state.spareComponents.filter((component) => component.category === category);
    if (!components.length) return "";
    const collapsed = !!state.ui.collapsedShopComponentGroups[`spareComponents:${category}`];
    return `
      <div class="shop-subsection ${collapsed ? "is-collapsed" : ""}">
        <div class="shop-subsection-header">
          <div>
            <h3>${formatComponentCategory(category)}s</h3>
            <div class="muted">${getShopComponentGroupSummary("spareComponents", category)}</div>
          </div>
          <button class="button secondary" aria-label="Toggle spare component group" title="Toggle spare component group" data-action="toggle-shop-component-group" data-section="spareComponents" data-category="${category}">${getToggleSymbol(collapsed)}</button>
        </div>
        <div class="stack compact shop-subsection-body">
          ${components.map((component) => `
            <div class="shop-card">
              <div>
                <strong>${component.name}</strong>
                <div class="muted">${component.used ? "Used" : "Previously new"} | Eff. ${component.efficiencyModifier.toFixed(2)}x | ${component.category === "psu" ? `Capacity ${formatNumber(getComponentDef(component.key).wattage)} W | Draw ${formatNumber(component.powerDraw)} W` : `${formatNumber(component.powerDraw)} W`}</div>
                <div class="muted">Durability ${formatPercent(component.durability / component.maxDurability)} | Used sale value ${formatMoney(getUsedSaleValue(component))}</div>
              </div>
              <div class="cheat-actions">
                <button class="button secondary" data-action="install-spare-component" data-component="${component.id}">Install</button>
                <button class="button" data-action="sell-spare-component" data-component="${component.id}">Sell Used</button>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }).join("") : `<div class="empty-state">No spare components in storage. Every board, CPU, and stick is currently spoken for.</div>`}
    <div class="shop-subsection ${!!state.ui.collapsedShopComponentGroups["spareComponents:gpu"] ? "is-collapsed" : ""}">
      <div class="shop-subsection-header">
        <div>
          <h3>GPUs</h3>
          <div class="muted">${getShopComponentGroupSummary("spareComponents", "gpu")}</div>
        </div>
        <button class="button secondary" aria-label="Toggle spare gpu group" title="Toggle spare gpu group" data-action="toggle-shop-component-group" data-section="spareComponents" data-category="gpu">${getToggleSymbol(!!state.ui.collapsedShopComponentGroups["spareComponents:gpu"])}</button>
      </div>
      ${state.spareGpus.length ? `
        <div class="stack compact shop-subsection-body">
          ${state.spareGpus.map((gpu) => `
            <div class="shop-card">
              <div>
                <strong>${gpu.name}</strong>
                <div class="muted">${gpu.used ? "Used" : "Previously new"} | ${formatNumber(gpu.hashrate)} HR | Draw ${formatNumber(gpu.powerDraw)} W</div>
                <div class="muted">Durability ${formatPercent(gpu.durability / gpu.maxDurability)} | Used sale value ${formatMoney(getUsedSaleValue(gpu))}</div>
              </div>
              <div class="cheat-actions">
                <button class="button secondary" data-action="install-spare-gpu" data-gpu="${gpu.id}" ${!freeSlotAvailable ? "disabled" : ""}>Install</button>
                <button class="button" data-action="sell-spare-gpu" data-gpu="${gpu.id}">Sell Used (${formatMoney(getUsedSaleValue(gpu))})</button>
              </div>
            </div>
          `).join("")}
        </div>
      ` : `<div class="empty-state">No spare GPUs in storage. Every card is either mounted or monetized.</div>`}
    </div>
  `;

  const availableFacilities = getAvailableFacilityPurchases();
  dom.facilityShop.innerHTML = availableFacilities.length ? availableFacilities.map((facility) => {
    const prerequisitesMet = (facility.prerequisiteFacilityKeys || []).every((key) => getOwnedFacilityKeys().includes(key));
    const earningsMet = state.lifetimeEarnings >= facility.earningsRequirement;
    const canBuy = prerequisitesMet && earningsMet && state.cash >= facility.upgradeCost;
    const prerequisiteText = facility.prerequisiteFacilityKeys && facility.prerequisiteFacilityKeys.length
      ? `Requires ${facility.prerequisiteFacilityKeys.map((key) => getFacilityByKey(key).name).join(", ")}`
      : "No site prerequisite";
    return `
      <div class="shop-card">
        <div>
          <strong>${facility.name}</strong>
          <div class="muted">${facility.description}</div>
          <div class="muted">${facility.maxMachines} machine cap | ${formatNumber(facility.powerCapacity)} W capacity</div>
          <div class="muted">Power rate ${facility.powerRateModifier.toFixed(2)}x | Solar ${facility.solarAllowed ? `${facility.solarEfficiency.toFixed(2)}x` : "not allowed"}</div>
          <div class="muted">${prerequisiteText}</div>
          <div class="muted">Requires ${formatMoney(facility.earningsRequirement)} lifetime earnings</div>
        </div>
        <div>
          <div><strong>${formatMoney(facility.upgradeCost)}</strong></div>
          <button class="button" data-action="buy-facility" data-facility="${facility.key}" ${canBuy ? "" : "disabled"}>Add Site</button>
        </div>
      </div>
    `;
  }).join("") : `<div class="empty-state">All facility sites unlocked. You now operate multiple expensive punchlines.</div>`;

  dom.facilityShop.innerHTML += `
    <div class="shop-section">
      <h3>External Power</h3>
      <div class="stack compact">
        ${EXTERNAL_POWER_DEFS.map((item) => `
          <div class="shop-card">
            <div>
              <strong>${item.name}</strong>
              <div class="muted">${item.description}</div>
              <div class="muted">Adds ${formatNumber(item.capacityWatts)} W site power limit</div>
              <div class="muted">Requires ${FACILITY_DEFS[item.facilityTierRequired].name}</div>
            </div>
            <div>
              <div><strong>${formatMoney(item.price)}</strong></div>
              <button class="button" data-action="buy-external-power" data-power="${item.key}" ${state.cash < item.price || !state.sites.some((site) => FACILITY_DEFS.findIndex((facility) => facility.key === site.facilityKey) >= item.facilityTierRequired) ? "disabled" : ""}>Buy</button>
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `;

  dom.solarShop.innerHTML = SOLAR_DEFS.map((solar) => `
    <div class="shop-card">
      <div>
        <strong>${solar.name}</strong>
        <div class="muted">${solar.description}</div>
        <div class="muted">Offsets ${formatNumber(solar.offsetWatts)} W before site efficiency</div>
        <div class="muted">Requires ${FACILITY_DEFS[solar.facilityTierRequired].name}</div>
      </div>
      <div>
        <div><strong>${formatMoney(solar.price)}</strong></div>
        <button class="button" data-action="buy-solar" data-solar="${solar.key}" ${state.cash < solar.price || !state.sites.some((site) => FACILITY_DEFS.findIndex((facility) => facility.key === site.facilityKey) >= solar.facilityTierRequired && getSiteFacility(site.id).solarAllowed) ? "disabled" : ""}>Buy</button>
      </div>
    </div>
  `).join("");

  dom.machineShop.querySelectorAll("[data-action='buy-machine']").forEach((button) => {
    button.addEventListener("click", () => openSelectionModal(
      `Choose which site should receive the new ${MACHINE_DEFS[button.dataset.machine].name}.`,
      getSitesWithCapacity().map((site) => {
        const facility = getFacilityByKey(site.facilityKey);
        return { value: site.id, label: `${facility.name} (${getSiteMachineCount(site.id)}/${facility.maxMachines})` };
      }),
      (siteId) => buyMachine(button.dataset.machine, siteId),
      "No owned site has spare machine capacity."
    ));
  });

  dom.componentShop.querySelectorAll("[data-action='buy-gpu']").forEach((button) => {
    button.addEventListener("click", () => {
      const gpu = GPU_DEFS[button.dataset.gpu];
      const installOptions = getAvailableInstallSlots().map((slot) => ({ value: `site:${slot.machineId}`, label: slot.label }));
      openSelectionModal(
        `Choose where to send ${gpu.name}.`,
        [...installOptions, { value: "storage", label: "Store for later" }],
        (value) => {
          if (value === "storage") {
            const def = GPU_DEFS[button.dataset.gpu];
            if (state.cash < def.price) return;
            state.cash -= def.price;
            state.spareGpus.push(createGpuInstance(button.dataset.gpu, false));
            addLog(`Bought ${def.name} for ${formatMoney(def.price)} and placed it into storage. Future overkill secured.`, "gain");
            renderAll();
            return;
          }
          buyGpu(button.dataset.gpu, null, value.replace("site:", ""));
        },
        "No valid destination is available."
      );
    });
  });

  dom.componentShop.querySelectorAll("[data-action='buy-component']").forEach((button) => {
    button.addEventListener("click", () => {
      const component = getComponentDef(button.dataset.component);
      openSelectionModal(
        `Choose where to send ${component.name}. Existing ${formatComponentCategory(component.category)} parts will be swapped into storage when possible.`,
        [
          ...getAvailableComponentTargets(component.category).map((target) => ({ value: `site:${target.machineId}:${target.slotIndex}`, label: target.label })),
          { value: "storage", label: "Store for later" }
        ],
        (value) => {
          if (value === "storage") {
            buyComponentToStorage(button.dataset.component);
            return;
          }
          const parts = value.split(":");
          buyComponent(button.dataset.component, parts[1], parts[2]);
        },
        "No machines are available for component installation."
      );
    });
  });

  dom.componentShop.querySelectorAll("[data-action='buy-psu-bay-shop']").forEach((button) => {
    button.addEventListener("click", () => promptBuyPsuBay(button.dataset.bay));
  });

  dom.componentShop.querySelectorAll("[data-action='buy-cooling-shop']").forEach((button) => {
    button.addEventListener("click", () => promptBuyCooling(button.dataset.cooling));
  });

  dom.spareComponentShop.querySelectorAll("[data-action='install-spare-gpu']").forEach((button) => {
    button.addEventListener("click", () => openSlotModal(
      `Choose where to install this stored GPU.`,
      (machineId) => installSpareGpu(button.dataset.gpu, machineId)
    ));
  });

  dom.spareComponentShop.querySelectorAll("[data-action='sell-spare-gpu']").forEach((button) => {
    button.addEventListener("click", () => sellSpareGpu(button.dataset.gpu));
  });

  dom.spareComponentShop.querySelectorAll("[data-action='install-spare-component']").forEach((button) => {
    button.addEventListener("click", () => {
      const component = state.spareComponents.find((entry) => entry.id === button.dataset.component);
      if (!component) return;
      openSelectionModal(
        `Choose which machine should receive ${component.name}.`,
        getAvailableComponentTargets(component.category).map((target) => ({ value: `${target.machineId}:${target.slotIndex}`, label: target.label })),
        (value) => {
          const parts = value.split(":");
          installSpareComponent(button.dataset.component, parts[0], parts[1]);
        },
        "No machines are available for component installation."
      );
    });
  });

  dom.spareComponentShop.querySelectorAll("[data-action='sell-spare-component']").forEach((button) => {
    button.addEventListener("click", () => sellSpareComponent(button.dataset.component));
  });

  document.querySelectorAll("[data-action='toggle-shop-component-group']").forEach((button) => {
    button.addEventListener("click", () => toggleShopComponentGroup(button.dataset.section, button.dataset.category));
  });

  dom.facilityShop.querySelectorAll("[data-action='buy-facility']").forEach((button) => {
    button.addEventListener("click", () => buyFacilitySite(button.dataset.facility));
  });

  dom.facilityShop.querySelectorAll("[data-action='buy-external-power']").forEach((button) => {
    button.addEventListener("click", () => {
      const item = EXTERNAL_POWER_DEFS.find((entry) => entry.key === button.dataset.power);
      if (!item) return;
      const eligibleSites = state.sites.filter((site) => FACILITY_DEFS.findIndex((facility) => facility.key === site.facilityKey) >= item.facilityTierRequired);
      openSelectionModal(
        `Choose which site should receive ${item.name}.`,
        eligibleSites.map((site) => {
          const facility = getFacilityByKey(site.facilityKey);
          return { value: site.id, label: `${facility.name} (${formatNumber(getSitePowerLimit(site.id) - getSiteProjectedPowerDraw(site.id))} W headroom)` };
        }),
        (siteId) => buyExternalPower(button.dataset.power, siteId),
        "No owned site can support that external power upgrade yet."
      );
    });
  });

  dom.solarShop.querySelectorAll("[data-action='buy-solar']").forEach((button) => {
    button.addEventListener("click", () => {
      const solar = SOLAR_DEFS.find((entry) => entry.key === button.dataset.solar);
      const eligibleSites = state.sites.filter((site) => FACILITY_DEFS.findIndex((facility) => facility.key === site.facilityKey) >= solar.facilityTierRequired && getSiteFacility(site.id).solarAllowed);
      openSelectionModal(
        `Choose which site should receive ${solar.name}.`,
        eligibleSites.map((site) => {
          const facility = getFacilityByKey(site.facilityKey);
          return { value: site.id, label: `${facility.name} (${formatNumber(getSiteSolarOffset(site.id))} W solar live)` };
        }),
        (siteId) => buySolar(button.dataset.solar, siteId),
        "No owned site can support that solar installation yet."
      );
    });
  });
}

function renderUsedMarket() {
  if (!state.usedMarketOffers.length) {
    dom.usedMarketPanel.innerHTML = `<div class="empty-state">No current offers. The secondary market is recalibrating its morals.</div>`;
    renderUsedTimer();
    return;
  }

  const freeSlotAvailable = hasFreeGpuSlot();
  const gpuOffers = state.usedMarketOffers.filter((offer) => offer.kind === "gpu");
  const componentOffers = state.usedMarketOffers.filter((offer) => offer.kind === "component");
  dom.usedMarketPanel.innerHTML = `
    <div class="shop-section">
      <h3>Used GPUs</h3>
      ${gpuOffers.length ? gpuOffers.map((offer) => {
        const def = GPU_DEFS[offer.gpuKey];
        const canBuy = state.cash >= offer.price && freeSlotAvailable;
        return `
          <div class="used-card">
            <div>
              <strong>${def.name}</strong>
              <div class="muted">Used listing | ${formatNumber(def.hashrate)} HR | Draw ${formatNumber(def.powerDraw)} W</div>
              <div class="muted">Durability ${formatPercent(offer.durability / def.durability)} | Failure risk elevated</div>
              <div class="muted">Choose an open slot or store it for later after clicking buy.</div>
            </div>
                    <div>
                      <div><strong>${formatMoney(offer.price)}</strong></div>
                      <button class="button" data-action="buy-used-gpu" data-offer="${offer.id}" ${canBuy ? "" : "disabled"}>Buy Used</button>
            </div>
          </div>
        `;
      }).join("") : `<div class="empty-state">No used GPUs listed right now.</div>`}
    </div>
    <div class="shop-section">
      <h3>Used Components</h3>
      ${componentOffers.length ? Object.keys(COMPONENT_DEFS).map((category) => {
        const offers = componentOffers.filter((offer) => offer.category === category);
        if (!offers.length) return "";
        return `
          <div class="shop-section">
            <h3>${formatComponentCategory(category)}s</h3>
            <div class="stack compact">
              ${offers.map((offer) => {
                const def = COMPONENT_DEFS[offer.category][offer.componentKey];
                const canBuy = state.cash >= offer.price;
                return `
                  <div class="used-card">
                    <div>
                      <strong>${def.name}</strong>
                      <div class="muted">Eff. ${def.efficiencyModifier.toFixed(2)}x | ${def.category === "psu" ? `Capacity ${formatNumber(def.wattage)} W | Draw ${formatNumber(def.powerDraw)} W` : `${formatNumber(def.powerDraw)} W`}</div>
                      <div class="muted">Durability ${formatPercent(offer.durability / def.durability)} | Failure risk elevated</div>
                      <div class="muted">Choose a machine or store it for later after clicking buy.</div>
                    </div>
                    <div>
                      <div><strong>${formatMoney(offer.price)}</strong></div>
                      <button class="button" data-action="buy-used-component" data-offer="${offer.id}" ${canBuy ? "" : "disabled"}>Buy Used</button>
                    </div>
                  </div>
                `;
              }).join("")}
            </div>
          </div>
        `;
      }).join("") : `<div class="empty-state">No used components listed right now.</div>`}
    </div>
  `;

  dom.usedMarketPanel.querySelectorAll("[data-action='buy-used-gpu']").forEach((button) => {
    button.addEventListener("click", () => {
      const offer = state.usedMarketOffers.find((entry) => entry.id === button.dataset.offer);
      if (!offer) return;
      const installOptions = getAvailableInstallSlots().map((slot) => ({ value: `site:${slot.machineId}`, label: slot.label }));
      openSelectionModal(
        `Choose where to send ${GPU_DEFS[offer.gpuKey].name} from the used market.`,
        [...installOptions, { value: "storage", label: "Store for later" }],
        (value) => {
          if (value === "storage") {
            const currentOffer = state.usedMarketOffers.find((entry) => entry.id === button.dataset.offer);
            if (!currentOffer || state.cash < currentOffer.price) return;
            state.cash -= currentOffer.price;
            state.spareGpus.push(createGpuInstance(currentOffer.gpuKey, true, currentOffer.durability));
            state.usedMarketOffers = state.usedMarketOffers.filter((entry) => entry.id !== button.dataset.offer);
            addLog(`Bought used ${GPU_DEFS[currentOffer.gpuKey].name} for ${formatMoney(currentOffer.price)} and placed it into storage.`, "gain");
            renderAll();
            return;
          }
          buyGpu(null, button.dataset.offer, value.replace("site:", ""));
        },
        "No valid destination is available."
      );
    });
  });

  dom.usedMarketPanel.querySelectorAll("[data-action='buy-used-component']").forEach((button) => {
    button.addEventListener("click", () => {
      const offer = state.usedMarketOffers.find((entry) => entry.id === button.dataset.offer);
      if (!offer) return;
      const def = COMPONENT_DEFS[offer.category][offer.componentKey];
      openSelectionModal(
        `Choose where to send used ${def.name}.`,
        [
          ...getAvailableComponentTargets(def.category).map((target) => ({ value: `site:${target.machineId}:${target.slotIndex}`, label: target.label })),
          { value: "storage", label: "Store for later" }
        ],
        (value) => {
          if (value === "storage") {
            buyComponentToStorage(offer.componentKey, button.dataset.offer);
            return;
          }
          const parts = value.split(":");
          buyComponent(offer.componentKey, parts[1], parts[2], button.dataset.offer);
        },
        "No machines are available for component installation."
      );
    });
  });

  renderUsedTimer();
}

function renderUsedTimer() {
  const remaining = Math.max(0, state.meta.usedMarketRefreshAt - Date.now());
  dom.usedMarketTimer.textContent = `Refresh in ${formatDuration(remaining)}`;
}

function renderEventLog() {
  dom.eventLogPanel.innerHTML = state.eventLog.length ? state.eventLog.map((entry) => `
    <div class="log-entry">
      <div class="${entry.type === "loss" ? "loss" : entry.type === "gain" ? "gain" : entry.type === "warn" ? "warn" : ""}">
        ${entry.message}
      </div>
      <time>${formatClock(entry.createdAt)}</time>
    </div>
  `).join("") : `<div class="empty-state">No events logged yet. Suspiciously calm.</div>`;
}

function renderCheats() {
  const multiplier = state.cheats.miningSpeedMultiplier || 1;
  const showVolatility = !!state.cheats.showVolatility;
  dom.cheatPanel.innerHTML = `
    <div class="cheat-row">
      <div>
        <strong>Money</strong>
        <div class="muted">Inject test cash without waiting for Dogeish to cooperate.</div>
      </div>
      <div class="cheat-actions">
        <button class="button secondary" data-action="cheat-cash" data-amount="1000">+$1k</button>
        <button class="button secondary" data-action="cheat-cash" data-amount="10000">+$10k</button>
        <button class="button secondary" data-action="cheat-cash" data-amount="100000">+$100k</button>
      </div>
    </div>
    <div class="cheat-row">
      <div>
        <strong>Mining Speed</strong>
        <div class="muted">Current multiplier: ${formatNumber(multiplier)}x</div>
      </div>
      <div class="cheat-actions">
        <button class="button secondary" data-action="cheat-speed" data-multiplier="1">1x</button>
        <button class="button secondary" data-action="cheat-speed" data-multiplier="5">5x</button>
        <button class="button secondary" data-action="cheat-speed" data-multiplier="20">20x</button>
        <input id="cheat-speed-input" class="cheat-input" type="number" min="1" step="1" value="${Math.round(multiplier)}">
        <button class="button" data-action="cheat-speed-custom">Set</button>
      </div>
    </div>
    <div class="cheat-row">
      <div>
        <strong>Market Debug</strong>
        <div class="muted">Reveal internal coin volatility and drift in the Coin Market panel.</div>
      </div>
      <div class="cheat-actions">
        <button class="button ${showVolatility ? "" : "secondary"}" data-action="toggle-volatility-cheat">${showVolatility ? "Hide Volatility" : "Show Volatility"}</button>
      </div>
    </div>
  `;

  dom.cheatPanel.querySelectorAll("[data-action='cheat-cash']").forEach((button) => {
    button.addEventListener("click", () => applyCheatCash(Number(button.dataset.amount)));
  });

  dom.cheatPanel.querySelectorAll("[data-action='cheat-speed']").forEach((button) => {
    button.addEventListener("click", () => setMiningSpeedCheat(Number(button.dataset.multiplier)));
  });

  const customButton = dom.cheatPanel.querySelector("[data-action='cheat-speed-custom']");
  const customInput = dom.cheatPanel.querySelector("#cheat-speed-input");
  customButton.addEventListener("click", () => {
    setMiningSpeedCheat(Number(customInput.value));
  });

  const volatilityButton = dom.cheatPanel.querySelector("[data-action='toggle-volatility-cheat']");
  volatilityButton.addEventListener("click", toggleVolatilityCheat);
}

function applyCheatCash(amount) {
  if (!Number.isFinite(amount) || amount <= 0) return;
  state.cash += amount;
  addLog(`Cheat applied: added ${formatMoney(amount)}. Regulatory oversight remains unavailable.`, "gain");
  renderAll();
}

function setMiningSpeedCheat(multiplier) {
  const safeMultiplier = Math.max(1, Math.floor(multiplier || 1));
  state.cheats.miningSpeedMultiplier = safeMultiplier;
  addLog(`Cheat applied: mining speed set to ${formatNumber(safeMultiplier)}x. Time is now negotiable.`, "gain");
  renderAll();
}

function toggleVolatilityCheat() {
  state.cheats.showVolatility = !state.cheats.showVolatility;
  addLog(`Cheat applied: market volatility display ${state.cheats.showVolatility ? "enabled" : "disabled"}.`, "gain");
  renderAll();
}

function getEstimatedMachineOutput(machine) {
  if (machine.status === "failed") return 0;
  const activeGpus = getActiveMachineGpus(machine);
  const activeComponents = getActiveComponents(machine);
  if (!activeGpus.length || !hasMinimumCoreComponents(machine) || !hasEnoughPsuCapacity(machine) || !machine.assignedCoin || !isCoinUnlocked(machine.assignedCoin)) return 0;
  const totalHashrate = activeGpus.reduce((sum, gpu) => sum + getDisplayedGpuHashrate(gpu), 0);
  const avgEfficiency = activeGpus.reduce((sum, gpu) => sum + gpu.efficiencyModifier * getGpuDurabilityModifier(gpu) * getGpuOutputMultiplier(gpu), 0) / activeGpus.length;
  const tuningComponents = activeComponents.filter((component) => component.category === "cpu" || component.category === "ram");
  const nonPsuComponents = activeComponents.filter((component) => component.category !== "psu");
  const baseComponentEfficiency = nonPsuComponents.reduce((sum, component) => sum + component.efficiencyModifier * getComponentDurabilityModifier(component), 0) / nonPsuComponents.length;
  const tuningEfficiency = tuningComponents.length
    ? tuningComponents.reduce((sum, component) => sum + component.efficiencyModifier * getComponentDurabilityModifier(component) * getComputeComponentEfficiencyMultiplier(component), 0) / tuningComponents.length
    : 1;
  const componentEfficiency = baseComponentEfficiency * tuningEfficiency;
  const healthModifier = clamp(machine.health / 100, 0.35, 1);
  return totalHashrate * COIN_DEFS[machine.assignedCoin].baseYield * 0.0024 * machine.baseEfficiency * avgEfficiency * componentEfficiency * healthModifier;
}

function getMachinePower(machine) {
  const psuPower = getComponentSlots(machine, "psu")
    .filter((psu) => psu && !psu.dead && psu.durability > 0)
    .reduce((sum, psu) => sum + getDisplayedComponentPower(psu), 0);
  return getMachineRequiredPower(machine) + psuPower;
}

function formatMoney(amount) {
  return `$${amount.toLocaleString(undefined, { maximumFractionDigits: amount >= 100 ? 0 : 2, minimumFractionDigits: amount < 10 ? 2 : 0 })}`;
}

function formatCoin(amount) {
  return amount.toLocaleString(undefined, { maximumFractionDigits: 4, minimumFractionDigits: amount > 0 && amount < 1 ? 2 : 0 });
}

function formatPercent(value) {
  return `${(value * 100).toFixed(0)}%`;
}

function getDurabilityClass(part) {
  if (!part) return "";
  const ratio = part.maxDurability > 0 ? part.durability / part.maxDurability : 0;
  if (ratio <= 0.2) return "loss";
  if (ratio <= 0.45) return "warn";
  return "";
}

function getDurabilityHtml(part) {
  return `<span class="${getDurabilityClass(part)}">${formatPercent(part.durability / part.maxDurability)}</span>`;
}

function formatSignedPercent(value) {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatNumber(value) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatClock(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomInRange(min, max) {
  return min + Math.random() * (max - min);
}

window.addEventListener("beforeunload", saveGame);
window.addEventListener("DOMContentLoaded", init);
