import type { Team } from "../engine/types";

// Seeded 2025-season power ratings on an Elo-like scale (1500 = league
// average). These are the MODEL's opinion of team strength and are the
// single most important input to tune. Swap these for your own numbers,
// or wire in a ratings feed. Roughly calibrated to preseason expectations.
export const TEAMS: Team[] = [
  // AFC East
  { id: "BUF", name: "Bills", conference: "AFC", division: "East", rating: 1610 },
  { id: "MIA", name: "Dolphins", conference: "AFC", division: "East", rating: 1505 },
  { id: "NYJ", name: "Jets", conference: "AFC", division: "East", rating: 1470 },
  { id: "NE", name: "Patriots", conference: "AFC", division: "East", rating: 1440 },
  // AFC North
  { id: "BAL", name: "Ravens", conference: "AFC", division: "North", rating: 1625 },
  { id: "CIN", name: "Bengals", conference: "AFC", division: "North", rating: 1560 },
  { id: "PIT", name: "Steelers", conference: "AFC", division: "North", rating: 1520 },
  { id: "CLE", name: "Browns", conference: "AFC", division: "North", rating: 1455 },
  // AFC South
  { id: "HOU", name: "Texans", conference: "AFC", division: "South", rating: 1560 },
  { id: "IND", name: "Colts", conference: "AFC", division: "South", rating: 1490 },
  { id: "JAX", name: "Jaguars", conference: "AFC", division: "South", rating: 1465 },
  { id: "TEN", name: "Titans", conference: "AFC", division: "South", rating: 1420 },
  // AFC West
  { id: "KC", name: "Chiefs", conference: "AFC", division: "West", rating: 1635 },
  { id: "LAC", name: "Chargers", conference: "AFC", division: "West", rating: 1535 },
  { id: "DEN", name: "Broncos", conference: "AFC", division: "West", rating: 1515 },
  { id: "LV", name: "Raiders", conference: "AFC", division: "West", rating: 1445 },
  // NFC East
  { id: "PHI", name: "Eagles", conference: "NFC", division: "East", rating: 1615 },
  { id: "DAL", name: "Cowboys", conference: "NFC", division: "East", rating: 1525 },
  { id: "WAS", name: "Commanders", conference: "NFC", division: "East", rating: 1540 },
  { id: "NYG", name: "Giants", conference: "NFC", division: "East", rating: 1435 },
  // NFC North
  { id: "DET", name: "Lions", conference: "NFC", division: "North", rating: 1620 },
  { id: "GB", name: "Packers", conference: "NFC", division: "North", rating: 1585 },
  { id: "MIN", name: "Vikings", conference: "NFC", division: "North", rating: 1545 },
  { id: "CHI", name: "Bears", conference: "NFC", division: "North", rating: 1490 },
  // NFC South
  { id: "TB", name: "Buccaneers", conference: "NFC", division: "South", rating: 1530 },
  { id: "ATL", name: "Falcons", conference: "NFC", division: "South", rating: 1500 },
  { id: "NO", name: "Saints", conference: "NFC", division: "South", rating: 1430 },
  { id: "CAR", name: "Panthers", conference: "NFC", division: "South", rating: 1425 },
  // NFC West
  { id: "SF", name: "49ers", conference: "NFC", division: "West", rating: 1600 },
  { id: "LAR", name: "Rams", conference: "NFC", division: "West", rating: 1560 },
  { id: "SEA", name: "Seahawks", conference: "NFC", division: "West", rating: 1520 },
  { id: "ARI", name: "Cardinals", conference: "NFC", division: "West", rating: 1480 },
];

export const TEAMS_BY_ID: Record<string, Team> = Object.fromEntries(
  TEAMS.map((t) => [t.id, t]),
);
