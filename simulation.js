export const TRADES = [
  { id: "excavation", name: "Excavation", team: 1, units: 85, baseProductivity: 1.18, outdoor: true, robotBoost: false, color: "#8c5a2b" },
  { id: "foundation", name: "Foundation", team: 2, units: 110, baseProductivity: 1.02, outdoor: true, robotBoost: false, color: "#556b78" },
  { id: "structure", name: "Structure", team: 3, units: 125, baseProductivity: 0.94, outdoor: true, robotBoost: true, color: "#2f6cab" },
  { id: "envelope", name: "Envelope", team: 4, units: 95, baseProductivity: 1.03, outdoor: true, robotBoost: true, color: "#d97706" },
  { id: "mep", name: "MEP", team: 5, units: 115, baseProductivity: 0.98, outdoor: false, robotBoost: false, color: "#0f766e" }
];

export const FLOORS = 10;
export const GAME_PATH = "games/live";
export const STATUS = {
  WAITING: "Waiting for lecturer",
  READY: "Ready",
  WORKING: "Working",
  BLOCKED: "Blocked",
  COMPLETED: "Completed",
  PAUSED: "Paused"
};

const HISTORY_LIMIT = 240;
const RAIN_MULTIPLIER = 0.78;
const ROBOT_MULTIPLIER = 1.2;
export const AUTO_PROGRESS_INTERVAL_MS = 1000;
const AUTO_PROGRESS_RATIO = 0.1;
const TAP_PROGRESS_RATIO = 0.28;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function taskId(tradeId, floor) {
  return `${tradeId}-F${floor}`;
}

function makeTeamState(trade) {
  return {
    team: trade.team,
    tradeId: trade.id,
    tradeName: trade.name,
    taps: 0,
    validTaps: 0,
    effectiveWork: 0,
    fatigueLevel: 0,
    lastTapTick: null,
    currentTaskId: taskId(trade.id, 1),
    currentFloor: 1,
    currentActivity: `${trade.name} Floor 1`,
    progressPct: 0,
    productivityMultiplier: 1,
    variabilityMultiplier: 1,
    rainMultiplier: 1,
    robotMultiplier: 1,
    fatigueMultiplier: 1,
    status: STATUS.WAITING
  };
}

function makeTask(trade, floor, plannedStart, plannedDuration) {
  return {
    id: taskId(trade.id, floor),
    floor,
    tradeId: trade.id,
    tradeName: trade.name,
    team: trade.team,
    required: trade.units,
    done: 0,
    status: "blocked",
    startTick: null,
    finishTick: null,
    plannedStartTick: plannedStart,
    plannedFinishTick: plannedStart + plannedDuration,
    latestWork: 0
  };
}

export function makeInitialState() {
  const tasks = {};
  const teams = {};
  let runningStart = 0;

  for (let floor = 1; floor <= FLOORS; floor += 1) {
    TRADES.forEach((trade, index) => {
      const plannedDuration = Math.ceil(trade.units / trade.baseProductivity);
      const plannedStart = runningStart + index * 12;
      tasks[taskId(trade.id, floor)] = makeTask(trade, floor, plannedStart, plannedDuration);
    });
    runningStart += 48;
  }

  TRADES.forEach((trade) => {
    teams[trade.team] = makeTeamState(trade);
  });

  const state = {
    initializedAt: Date.now(),
    running: false,
    tick: 0,
    startedAt: null,
    lastAutoProgressAt: null,
    controls: {
      fatigueEnabled: true,
      rainEnabled: false,
      robotEnabled: false
    },
    environment: {
      rainActive: false,
      robotAssistanceActive: false
    },
    teams,
    tasks,
    history: [
      {
        tick: 0,
        overallProgress: 0,
        completedTasks: 0,
        workingCrews: 0,
        blockedCrews: TRADES.length,
        activeFloor: 1
      }
    ],
    events: [
      {
        tick: 0,
        type: "system",
        message: "Simulation initialized"
      }
    ],
    uiMessage: "Simulation initialized"
  };

  updateStatuses(state);
  return state;
}

function getTradeByTeam(teamNumber) {
  return TRADES.find((trade) => trade.team === Number(teamNumber)) || null;
}

function getTradeById(tradeId) {
  return TRADES.find((trade) => trade.id === tradeId) || null;
}

function calculateFatigueMultiplier(teamState, controls) {
  if (!controls?.fatigueEnabled) {
    return 1;
  }
  const sustained = Math.max(0, (teamState?.validTaps || 0) - 3);
  return clamp(1 - sustained * 0.012, 0.62, 1);
}

function calculateRainMultiplier(trade, environment) {
  if (!environment?.rainActive || !trade?.outdoor) {
    return 1;
  }
  return RAIN_MULTIPLIER;
}

function calculateRobotMultiplier(trade, environment) {
  if (!environment?.robotAssistanceActive || !trade?.robotBoost) {
    return 1;
  }
  return ROBOT_MULTIPLIER;
}

function getProgressPct(task) {
  if (!task?.required) {
    return 0;
  }
  return Math.round((clamp(task.done, 0, task.required) / task.required) * 100);
}

export function overallProgress(state) {
  const tasks = Object.values(state?.tasks || {});
  const required = tasks.reduce((sum, task) => sum + (Number(task.required) || 0), 0);
  const done = tasks.reduce((sum, task) => sum + clamp(Number(task.done) || 0, 0, Number(task.required) || 0), 0);
  return required ? done / required : 0;
}

export function getCompletedTasksCount(state) {
  return Object.values(state?.tasks || {}).filter((task) => task.done >= task.required).length;
}

export function getActiveFloor(state) {
  const tasks = Object.values(state?.tasks || {});
  const unfinished = tasks
    .filter((task) => task.done < task.required)
    .sort((a, b) => a.floor - b.floor || a.team - b.team);
  return unfinished[0]?.floor || FLOORS;
}

export function isEligible(state, task) {
  if (!state || !task || task.done >= task.required) {
    return false;
  }

  const tradeIndex = TRADES.findIndex((trade) => trade.id === task.tradeId);
  if (tradeIndex === -1) {
    return false;
  }

  if (task.floor > 1) {
    const previousFloorTask = state.tasks?.[taskId(task.tradeId, task.floor - 1)];
    if (!previousFloorTask || previousFloorTask.done < previousFloorTask.required) {
      return false;
    }
  }

  if (tradeIndex > 0) {
    const predecessorTrade = TRADES[tradeIndex - 1];
    const predecessorTask = state.tasks?.[taskId(predecessorTrade.id, task.floor)];
    if (!predecessorTask || predecessorTask.done < predecessorTask.required) {
      return false;
    }
  }

  return true;
}

function getCandidateTask(state, teamNumber) {
  return Object.values(state?.tasks || {})
    .filter((task) => task.team === Number(teamNumber) && isEligible(state, task))
    .sort((a, b) => a.floor - b.floor)[0] || null;
}

function getFallbackTask(state, teamNumber) {
  return Object.values(state?.tasks || {})
    .filter((task) => task.team === Number(teamNumber) && task.done < task.required)
    .sort((a, b) => a.floor - b.floor)[0] || null;
}

function summarizeTeamStatus(state, teamNumber, candidate) {
  if (!state) {
    return STATUS.WAITING;
  }
  if (!state.running) {
    return state.tick > 0 ? STATUS.PAUSED : STATUS.WAITING;
  }
  if (candidate) {
    return candidate.done > 0 ? STATUS.WORKING : STATUS.READY;
  }
  const fallback = getFallbackTask(state, teamNumber);
  return fallback ? STATUS.BLOCKED : STATUS.COMPLETED;
}

function appendEvent(state, type, message, payload = {}) {
  state.events ||= [];
  state.events.push({
    tick: state.tick || 0,
    type,
    message,
    ...payload
  });
  if (state.events.length > HISTORY_LIMIT) {
    state.events = state.events.slice(-HISTORY_LIMIT);
  }
}

function appendHistory(state) {
  const snapshot = {
    tick: state.tick || 0,
    overallProgress: round(overallProgress(state) * 100),
    completedTasks: getCompletedTasksCount(state),
    workingCrews: Object.values(state.teams || {}).filter((team) => team.status === STATUS.WORKING).length,
    blockedCrews: Object.values(state.teams || {}).filter((team) => team.status === STATUS.BLOCKED).length,
    activeFloor: getActiveFloor(state)
  };
  const history = state.history || [];
  const last = history[history.length - 1];
  if (!last || last.tick !== snapshot.tick || last.overallProgress !== snapshot.overallProgress) {
    history.push(snapshot);
  } else {
    history[history.length - 1] = snapshot;
  }
  state.history = history.slice(-HISTORY_LIMIT);
}

function normalizeTask(rawTask, trade, floor) {
  const plannedDuration = Math.ceil(trade.units / trade.baseProductivity);
  const safeTask = {
    ...makeTask(trade, floor, (floor - 1) * 48 + TRADES.findIndex((entry) => entry.id === trade.id) * 12, plannedDuration),
    ...(rawTask || {})
  };
  safeTask.team = trade.team;
  safeTask.tradeId = trade.id;
  safeTask.tradeName = trade.name;
  safeTask.floor = floor;
  safeTask.required = Number.isFinite(Number(safeTask.required)) ? Number(safeTask.required) : trade.units;
  safeTask.done = clamp(Number(safeTask.done) || 0, 0, safeTask.required);
  safeTask.startTick = Number.isFinite(Number(safeTask.startTick)) ? Number(safeTask.startTick) : null;
  safeTask.finishTick = Number.isFinite(Number(safeTask.finishTick)) ? Number(safeTask.finishTick) : null;
  safeTask.plannedStartTick = Number.isFinite(Number(safeTask.plannedStartTick)) ? Number(safeTask.plannedStartTick) : safeTask.plannedStartTick;
  safeTask.plannedFinishTick = Number.isFinite(Number(safeTask.plannedFinishTick)) ? Number(safeTask.plannedFinishTick) : safeTask.plannedFinishTick;
  safeTask.latestWork = round(Number(safeTask.latestWork) || 0);
  return safeTask;
}

export function sanitizeState(rawState) {
  const fallback = makeInitialState();
  if (!rawState || typeof rawState !== "object") {
    return fallback;
  }

  const safeState = {
    ...fallback,
    ...rawState,
    controls: {
      ...fallback.controls,
      ...(rawState.controls || {})
    },
    environment: {
      ...fallback.environment,
      ...(rawState.environment || {})
    },
    teams: {},
    tasks: {},
    history: Array.isArray(rawState.history) ? rawState.history.filter((item) => item && Number.isFinite(Number(item.tick))).slice(-HISTORY_LIMIT) : fallback.history,
    events: Array.isArray(rawState.events) ? rawState.events.slice(-HISTORY_LIMIT) : fallback.events
  };

  safeState.running = Boolean(rawState.running);
  safeState.tick = Number.isFinite(Number(rawState.tick)) ? Number(rawState.tick) : 0;
  safeState.startedAt = rawState.startedAt || null;
  safeState.initializedAt = rawState.initializedAt || fallback.initializedAt;
  safeState.lastAutoProgressAt = Number.isFinite(Number(rawState.lastAutoProgressAt))
    ? Number(rawState.lastAutoProgressAt)
    : null;

  TRADES.forEach((trade) => {
    const rawTeam = rawState.teams?.[trade.team] || rawState.teams?.[String(trade.team)] || {};
    safeState.teams[trade.team] = {
      ...makeTeamState(trade),
      ...rawTeam,
      team: trade.team,
      tradeId: trade.id,
      tradeName: trade.name,
      taps: Math.max(0, Number(rawTeam.taps) || 0),
      validTaps: Math.max(0, Number(rawTeam.validTaps) || 0),
      effectiveWork: round(Math.max(0, Number(rawTeam.effectiveWork) || 0)),
      fatigueLevel: round(Math.max(0, Number(rawTeam.fatigueLevel) || 0))
    };
  });

  for (let floor = 1; floor <= FLOORS; floor += 1) {
    TRADES.forEach((trade) => {
      const id = taskId(trade.id, floor);
      safeState.tasks[id] = normalizeTask(rawState.tasks?.[id], trade, floor);
    });
  }

  updateStatuses(safeState);
  appendHistory(safeState);
  return safeState;
}

export function updateStatuses(state) {
  Object.values(state.tasks || {}).forEach((task) => {
    if (task.done >= task.required) {
      task.status = "complete";
      if (task.finishTick === null) {
        task.finishTick = state.tick || 0;
      }
      return;
    }
    task.status = isEligible(state, task) ? (task.done > 0 ? "active" : "ready") : "blocked";
  });

  TRADES.forEach((trade) => {
    const team = state.teams[trade.team];
    const candidate = getCandidateTask(state, trade.team);
    const fallback = candidate || getFallbackTask(state, trade.team);
    const fatigueMultiplier = calculateFatigueMultiplier(team, state.controls);
    const rainMultiplier = calculateRainMultiplier(trade, state.environment);
    const robotMultiplier = calculateRobotMultiplier(trade, state.environment);
    const productivityMultiplier = round(fatigueMultiplier * rainMultiplier * robotMultiplier * (team.variabilityMultiplier || 1));
    const task = fallback;

    team.currentTaskId = task?.id || null;
    team.currentFloor = task?.floor || FLOORS;
    team.currentActivity = task ? `${task.tradeName} Floor ${task.floor}` : `${trade.name} complete`;
    team.progressPct = task ? getProgressPct(task) : 100;
    team.fatigueMultiplier = round(fatigueMultiplier);
    team.rainMultiplier = round(rainMultiplier);
    team.robotMultiplier = round(robotMultiplier);
    team.productivityMultiplier = round(productivityMultiplier);
    team.status = summarizeTeamStatus(state, trade.team, candidate);
  });

  state.uiMessage = state.running ? "Simulation running" : state.tick > 0 ? "Simulation paused" : "Waiting for lecturer";
}

export function applyControlToggle(rawState, controlKey, active) {
  const state = sanitizeState(rawState);
  if (controlKey === "fatigueEnabled") {
    state.controls.fatigueEnabled = Boolean(active);
  }
  if (controlKey === "rainEnabled") {
    state.controls.rainEnabled = Boolean(active);
    state.environment.rainActive = Boolean(active);
  }
  if (controlKey === "robotEnabled") {
    state.controls.robotEnabled = Boolean(active);
    state.environment.robotAssistanceActive = Boolean(active);
  }
  appendEvent(state, "control", `${controlKey} ${active ? "enabled" : "disabled"}`);
  updateStatuses(state);
  appendHistory(state);
  return state;
}

export function setRunning(rawState, running) {
  const state = sanitizeState(rawState);
  state.running = Boolean(running);
  if (state.running && !state.startedAt) {
    state.startedAt = Date.now();
  }
  if (state.running && !state.lastAutoProgressAt) {
    state.lastAutoProgressAt = Date.now();
  }
  appendEvent(state, "control", state.running ? "Simulation started" : "Simulation paused");
  updateStatuses(state);
  appendHistory(state);
  return state;
}

function calculateWorkAmount(task, baseRatio, totalMultiplier, varianceMin, varianceMax) {
  const variabilityMultiplier = round(varianceMin + Math.random() * (varianceMax - varianceMin));
  const work = round(task.required * baseRatio * totalMultiplier * variabilityMultiplier);
  return { variabilityMultiplier, work: clamp(work, 0, task.required) };
}

function applyWorkToTask(state, teamNumber, source, baseRatio) {
  const team = state.teams?.[teamNumber];
  const trade = getTradeByTeam(teamNumber);
  const candidate = getCandidateTask(state, teamNumber);

  if (!team || !trade || !candidate) {
    return false;
  }

  state.tick += 1;

  const fatigueMultiplier = calculateFatigueMultiplier(team, state.controls);
  const rainMultiplier = calculateRainMultiplier(trade, state.environment);
  const robotMultiplier = calculateRobotMultiplier(trade, state.environment);
  const totalMultiplier = fatigueMultiplier * rainMultiplier * robotMultiplier;
  const varianceRange = source === "tap" ? [0.9, 1.18] : [0.92, 1.08];
  const { variabilityMultiplier, work } = calculateWorkAmount(
    candidate,
    baseRatio,
    totalMultiplier,
    varianceRange[0],
    varianceRange[1]
  );

  if (candidate.startTick === null) {
    candidate.startTick = state.tick;
  }

  team.lastTapTick = state.tick;
  team.variabilityMultiplier = variabilityMultiplier;
  team.fatigueMultiplier = round(fatigueMultiplier);
  team.rainMultiplier = round(rainMultiplier);
  team.robotMultiplier = round(robotMultiplier);
  team.productivityMultiplier = round(totalMultiplier * variabilityMultiplier);
  team.fatigueLevel = round((1 - fatigueMultiplier) * 100);

  candidate.done = clamp(round(candidate.done + work), 0, candidate.required);
  candidate.latestWork = work;
  team.effectiveWork = round(team.effectiveWork + work);

  if (candidate.done >= candidate.required) {
    candidate.finishTick = state.tick;
    appendEvent(state, "complete", `${trade.name} finished Floor ${candidate.floor}`, {
      team: teamNumber,
      taskId: candidate.id,
      source
    });
  } else {
    appendEvent(state, source, `${trade.name} worked on Floor ${candidate.floor}`, {
      team: teamNumber,
      taskId: candidate.id,
      work
    });
  }

  return true;
}

export function applyTap(rawState, teamNumber) {
  const state = sanitizeState(rawState);
  const team = state.teams?.[teamNumber];
  const trade = getTradeByTeam(teamNumber);

  if (!team || !trade) {
    appendEvent(state, "invalid", `Unknown team ${teamNumber}`);
    return state;
  }

  team.taps += 1;

  if (!state.running) {
    appendEvent(state, "ignored", `${trade.name} tapped while paused`);
    updateStatuses(state);
    appendHistory(state);
    return state;
  }

  const candidate = getCandidateTask(state, teamNumber);
  if (!candidate) {
    appendEvent(state, "blocked", `${trade.name} has no eligible activity`, { team: teamNumber });
    updateStatuses(state);
    appendHistory(state);
    return state;
  }

  team.validTaps += 1;
  applyWorkToTask(state, teamNumber, "tap", TAP_PROGRESS_RATIO);

  updateStatuses(state);
  appendHistory(state);
  return state;
}

export function applyAutoProgress(rawState, now = Date.now()) {
  const state = sanitizeState(rawState);
  if (!state.running) {
    return state;
  }

  const lastAutoProgressAt = state.lastAutoProgressAt || now;
  const elapsed = now - lastAutoProgressAt;
  const steps = Math.floor(elapsed / AUTO_PROGRESS_INTERVAL_MS);
  if (steps <= 0) {
    return state;
  }

  for (let step = 0; step < steps; step += 1) {
    TRADES.forEach((trade) => {
      applyWorkToTask(state, trade.team, "auto", AUTO_PROGRESS_RATIO);
    });
  }

  state.lastAutoProgressAt = lastAutoProgressAt + steps * AUTO_PROGRESS_INTERVAL_MS;
  appendEvent(state, "auto", `Automatic progress advanced ${steps} step(s)`);
  updateStatuses(state);
  appendHistory(state);
  return state;
}

export function getTeamSnapshot(state, teamNumber) {
  const safeState = sanitizeState(state);
  const trade = getTradeByTeam(teamNumber);
  if (!trade) {
    return null;
  }
  const team = safeState.teams[teamNumber];
  const task = safeState.tasks[team.currentTaskId] || getFallbackTask(safeState, teamNumber);
  return {
    trade,
    team,
    task,
    activeFloor: getActiveFloor(safeState),
    overallProgressPct: Math.round(overallProgress(safeState) * 100)
  };
}

export function getDashboardMetrics(state) {
  const safeState = sanitizeState(state);
  return {
    overallProgressPct: Math.round(overallProgress(safeState) * 100),
    tick: safeState.tick,
    workingCrews: Object.values(safeState.teams).filter((team) => team.status === STATUS.WORKING).length,
    blockedCrews: Object.values(safeState.teams).filter((team) => team.status === STATUS.BLOCKED).length,
    completedTasks: getCompletedTasksCount(safeState),
    activeFloor: getActiveFloor(safeState)
  };
}

export function getTaskNodeState(task) {
  if (!task) {
    return "blocked";
  }
  if (task.done >= task.required) {
    return "complete";
  }
  if (task.status === "active") {
    return "active";
  }
  if (task.status === "ready") {
    return "ready";
  }
  return "blocked";
}

export function getTradeColor(tradeId) {
  return getTradeById(tradeId)?.color || "#4b5563";
}
