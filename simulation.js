export const TRADES = [
  { id: "excavation", name: "Excavation", team: 1, units: 80, productivity: 1.20 },
  { id: "foundation", name: "Foundation", team: 2, units: 100, productivity: 1.00 },
  { id: "structure", name: "Structure", team: 3, units: 120, productivity: 0.90 },
  { id: "envelope", name: "Envelope", team: 4, units: 90, productivity: 1.05 },
  { id: "mep", name: "MEP", team: 5, units: 110, productivity: 0.95 }
];

export const FLOORS = 5;

export function makeInitialState() {
  const tasks = {};
  for (let floor = 1; floor <= FLOORS; floor++) {
    for (let i = 0; i < TRADES.length; i++) {
      const trade = TRADES[i];
      const id = `${trade.id}-F${floor}`;
      tasks[id] = {
        id,
        floor,
        tradeId: trade.id,
        tradeName: trade.name,
        team: trade.team,
        required: trade.units,
        done: 0,
        status: "blocked",
        startTick: null,
        finishTick: null
      };
    }
  }
  tasks["excavation-F1"].status = "ready";
  return {
    running: false,
    tick: 0,
    startedAt: null,
    teams: {
      1: { taps: 0, effectiveWork: 0 },
      2: { taps: 0, effectiveWork: 0 },
      3: { taps: 0, effectiveWork: 0 },
      4: { taps: 0, effectiveWork: 0 },
      5: { taps: 0, effectiveWork: 0 }
    },
    tasks
  };
}

function taskId(tradeId, floor) {
  return `${tradeId}-F${floor}`;
}

export function isEligible(state, task) {
  if (task.done >= task.required) return false;

  const tradeIndex = TRADES.findIndex(t => t.id === task.tradeId);

  // Same trade must finish the previous floor.
  if (task.floor > 1) {
    const previousFloor = state.tasks[taskId(task.tradeId, task.floor - 1)];
    if (!previousFloor || previousFloor.done < previousFloor.required) return false;
  }

  // Previous trade must finish the same floor.
  if (tradeIndex > 0) {
    const previousTrade = TRADES[tradeIndex - 1];
    const predecessor = state.tasks[taskId(previousTrade.id, task.floor)];
    if (!predecessor || predecessor.done < predecessor.required) return false;
  }

  return true;
}

export function updateStatuses(state) {
  Object.values(state.tasks).forEach(task => {
    if (task.done >= task.required) {
      task.status = "complete";
    } else if (isEligible(state, task)) {
      task.status = task.done > 0 ? "active" : "ready";
    } else {
      task.status = "blocked";
    }
  });
}

export function applyTap(state, teamNumber) {
  if (!state.running) return state;

  state.tick = (state.tick || 0) + 1;
  state.teams[teamNumber].taps += 1;
  updateStatuses(state);

  const trade = TRADES.find(t => t.team === teamNumber);
  const candidate = Object.values(state.tasks)
    .filter(t => t.team === teamNumber && isEligible(state, t))
    .sort((a, b) => a.floor - b.floor)[0];

  if (!candidate) return state;

  if (candidate.startTick === null) candidate.startTick = state.tick;

  // Small fatigue effect: productivity falls after sustained tapping.
  const taps = state.teams[teamNumber].taps;
  const fatigue = Math.max(0.55, 1 - Math.floor(taps / 80) * 0.05);

  // Small uncertainty factor; useful for discussing variability.
  const variability = 0.85 + Math.random() * 0.30;
  const work = trade.productivity * fatigue * variability;

  candidate.done = Math.min(candidate.required, candidate.done + work);
  state.teams[teamNumber].effectiveWork += work;

  if (candidate.done >= candidate.required) {
    candidate.finishTick = state.tick;
  }

  updateStatuses(state);
  return state;
}

export function overallProgress(state) {
  const tasks = Object.values(state.tasks || {});
  const required = tasks.reduce((s, t) => s + t.required, 0);
  const done = tasks.reduce((s, t) => s + Math.min(t.done, t.required), 0);
  return required ? done / required : 0;
}
