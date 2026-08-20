import { vixFill, vixNavigate } from "./index.js";

const reply = await vixFill("What is the meaning of life?");
console.log("Vix:", reply);

// --- Offline navigation matching ---

const routes = [
  { name: "Settings", keywords: ["settings", "preferences", "options"], target: "/settings" },
  { name: "Home", keywords: ["home", "main", "dashboard"], target: "/home" },
  { name: "Profile", keywords: ["profile", "account", "me"], target: "/profile" },
];

const cases = [
  { command: "open my settengs", expected: "/settings" },
  { command: "take me to the dashbord", expected: "/home" },
  { command: "show my account stuff", expected: "/profile" },
  { command: "gibberish xyz", expected: null },
];

let failures = 0;

for (const { command, expected } of cases) {
  const result = vixNavigate(command, routes);
  const pass = result === expected;
  if (!pass) failures++;
  console.log(`vixNavigate("${command}") -> ${result} [${pass ? "PASS" : "FAIL"}]`);
}

if (failures > 0) {
  console.error(`${failures} vixNavigate test case(s) failed`);
  process.exit(1);
}
