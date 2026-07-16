export const TRADES = [
  { id: "excavation", name: "Structural Frame", team: 1, units: 85, baseProductivity: 1.18, outdoor: true, robotBoost: false, color: "#8c5a2b" },
  { id: "foundation", name: "Floor Deck", team: 2, units: 110, baseProductivity: 1.02, outdoor: true, robotBoost: false, color: "#556b78" },
  { id: "structure", name: "Facade & Windows", team: 3, units: 125, baseProductivity: 0.94, outdoor: true, robotBoost: true, color: "#2f6cab" },
  { id: "envelope", name: "MEP Rough-In", team: 4, units: 95, baseProductivity: 1.03, outdoor: false, robotBoost: true, color: "#d97706" },
  { id: "mep", name: "Interior Finish", team: 5, units: 145, baseProductivity: 0.84, outdoor: false, robotBoost: false, color: "#0f766e" }
];

export const FLOORS = 3;
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
const AUTO_PROGRESS_RATIO = 0.05;
const TAP_PROGRESS_RATIO = 0.085;
const PLANNED_PROGRESS_RATIO = 0.058;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function deterministicNoise(seed) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(index);
    hash |= 0;
  }
  const normalized = Math.abs(Math.sin(hash) * 10000) % 1;
  return normalized;
}

function taskId(tradeId, floor) {
  return `${tradeId}-F${floor}`;
}

function buildPlannedWindows() {
  const tasks = {};
  const taskProgress = {};
  const plannedWindows = {};
  let tick = 0;

  for (let floor = 1; floor <= FLOORS; floor += 1) {
    TRADES.forEach((trade) => {
      const id = taskId(trade.id, floor);
      tasks[id] = {
        id,
        floor,
        tradeId: trade.id,
        team: trade.team,
        required: trade.units
      };
      taskProgress[id] = 0;
    });
  }

  function isTaskEligible(task) {
    if (taskProgress[task.id] >= task.required) {
      return false;
    }
    const tradeIndex = TRADES.findIndex((trade) => trade.id === task.tradeId);
    if (task.floor > 1) {
      const previousFloorId = taskId(task.tradeId, task.floor - 1);
      if (taskProgress[previousFloorId] < tasks[previousFloorId].required) {
        return false;
      }
    }
    if (tradeIndex > 0) {
      const predecessorId = taskId(TRADES[tradeIndex - 1].id, task.floor);
      if (taskProgress[predecessorId] < tasks[predecessorId].required) {
        return false;
      }
    }
    return true;
  }

  while (Object.keys(plannedWindows).length < FLOORS * TRADES.length && tick < 5000) {
    let progressedThisCycle = false;

    TRADES.forEach((trade) => {
      const candidate = Object.values(tasks)
        .filter((task) => task.team === trade.team && isTaskEligible(task))
        .sort((a, b) => a.floor - b.floor)[0];

      if (!candidate) {
        return;
      }

      tick += 1;
      progressedThisCycle = true;

      if (!plannedWindows[candidate.id]) {
        plannedWindows[candidate.id] = {
          start: tick
        };
      }

      const variability = 0.96 + deterministicNoise(`${candidate.id}-plan`) * 0.18;
      const work = candidate.required * PLANNED_PROGRESS_RATIO * variability;
      taskProgress[candidate.id] = clamp(taskProgress[candidate.id] + work, 0, candidate.required);

      if (taskProgress[candidate.id] >= candidate.required) {
        plannedWindows[candidate.id].finish = tick;
      }
    });

    if (!progressedThisCycle) {
      break;
    }
  }

  return plannedWindows;
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
  const plannedWindows = buildPlannedWindows();

  for (let floor = 1; floor <= FLOORS; floor += 1) {
    TRADES.forEach((trade) => {
      const plannedWindow = plannedWindows[taskId(trade.id, floor)];
      const plannedStart = plannedWindow?.start ?? 0;
      const plannedFinish = plannedWindow?.finish ?? plannedStart + 1;
      tasks[taskId(trade.id, floor)] = {
        ...makeTask(trade, floor, plannedStart, plannedFinish - plannedStart),
        plannedStartTick: plannedStart,
        plannedFinishTick: plannedFinish
      };
    });
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

function calculatePhaseMultiplier(state) {
  const progress = overallProgress(state);
  const bellCurve = 1 - Math.pow((progress - 0.5) / 0.5, 2);
  return round(clamp(0.72 + bellCurve * 0.56, 0.72, 1.28));
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

export function getTotalRequiredUnits() {
  return TRADES.reduce((sum, trade) => sum + trade.units, 0) * FLOORS;
}

export function getTaskPlannedPoints(state) {
  const safeState = sanitizeState(state);
  const tasks = Object.values(safeState.tasks);
  const totalRequired = getTotalRequiredUnits();
  const maxTick = Math.max(...tasks.map((task) => task.plannedFinishTick), 1);

  return Array.from({ length: maxTick + 1 }, (_, tick) => {
    const completedUnits = tasks.reduce((sum, task) => {
      if (tick <= task.plannedStartTick) {
        return sum;
      }
      if (tick >= task.plannedFinishTick) {
        return sum + task.required;
      }
      const span = Math.max(1, task.plannedFinishTick - task.plannedStartTick);
      const portion = (tick - task.plannedStartTick) / span;
      return sum + task.required * portion;
    }, 0);

    return {
      x: tick,
      y: round((completedUnits / totalRequired) * 100)
    };
  });
}

function normalizeTask(rawTask, trade, floor) {
  const plannedWindows = buildPlannedWindows();
  const plannedWindow = plannedWindows[taskId(trade.id, floor)];
  const fallbackPlannedStart = plannedWindow?.start ?? 0;
  const plannedDuration = Math.max(1, (plannedWindow?.finish ?? 1) - fallbackPlannedStart);
  const safeTask = {
    ...makeTask(trade, floor, fallbackPlannedStart, plannedDuration),
    ...(rawTask || {})
  };
  safeTask.team = trade.team;
  safeTask.tradeId = trade.id;
  safeTask.tradeName = trade.name;
  safeTask.floor = floor;
  safeTask.required = Number.isFinite(Number(safeTask.required)) ? Number(safeTask.required) : trade.units;
  safeTask.done = clamp(Number(safeTask.done) || 0, 0, safeTask.required);
  safeTask.startTick = Number.isFinite(Number(safeTask.startTick)) && Number(safeTask.startTick) > 0
    ? Number(safeTask.startTick)
    : null;
  safeTask.finishTick = Number.isFinite(Number(safeTask.finishTick)) && Number(safeTask.finishTick) > 0
    ? Number(safeTask.finishTick)
    : null;
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
  const phaseMultiplier = calculatePhaseMultiplier(state);
  const totalMultiplier = fatigueMultiplier * rainMultiplier * robotMultiplier * phaseMultiplier;
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
  const workingCrews = TRADES.filter((trade) => {
    const candidate = Object.values(safeState.tasks).find((task) =>
      task.team === trade.team && isEligible(safeState, task) && task.done > 0 && task.done < task.required
    );
    return Boolean(candidate) && safeState.running;
  }).length;

  const blockedCrews = TRADES.filter((trade) => {
    const remainingTasks = Object.values(safeState.tasks).filter((task) =>
      task.team === trade.team && task.done < task.required
    );
    if (!remainingTasks.length) {
      return false;
    }
    const eligibleTask = remainingTasks.find((task) => isEligible(safeState, task));
    return !eligibleTask;
  }).length;

  return {
    overallProgressPct: Math.round(overallProgress(safeState) * 100),
    tick: safeState.tick,
    workingCrews,
    blockedCrews,
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
