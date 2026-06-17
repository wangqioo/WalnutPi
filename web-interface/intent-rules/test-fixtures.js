import { readFile } from "node:fs/promises";
import path from "node:path";
import { evaluateRuleIntent } from "./evaluator.js";

const fixturesPath = path.join(import.meta.dir, "fixtures.json");
const fixtures = JSON.parse(await readFile(fixturesPath, "utf8"));
let failures = 0;

for (const fixture of fixtures) {
  const result = await evaluateRuleIntent(fixture.text);
  const classification = result.classification;
  const ok = classification?.intent === fixture.intent && classification?.delivery === fixture.delivery;
  if (!ok) {
    failures += 1;
    console.error(JSON.stringify({
      text: fixture.text,
      expected: { intent: fixture.intent, delivery: fixture.delivery },
      actual: classification,
    }, null, 2));
  }
}

if (failures) {
  console.error(`${failures} intent rule fixture(s) failed`);
  process.exit(1);
}
console.log(`${fixtures.length} intent rule fixture(s) passed`);
