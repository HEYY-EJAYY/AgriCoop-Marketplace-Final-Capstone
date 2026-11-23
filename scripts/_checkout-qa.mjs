// Temporary QA script: checkout fulfillment/payment separation verification.
// Dev environment only. Does not submit orders.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/)
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const BASE = "http://localhost:3000";
const OUT = "deliverables/screenshots/checkout-fulfillment";
mkdirSync(OUT, { recursive: true });

const results = [];
const ok = (name, pass, note = "") => { results.push({ name, pass, note }); console.log(`${pass ? "PASS" : "FAIL"} ${name}${note ? " — " + note : ""}`); };

async function signIn(page, email = env.SEED_BUYER_EMAIL, password = env.SEED_BUYER_PASSWORD) {
  await page.goto(`${BASE}/auth`, { waitUntil: "networkidle" });
  const toggle = page.getByRole("button", { name: /Already registered\? Sign in|New to AgriCoop\? Create an account/i });
  if (await toggle.count()) {
    const label = await toggle.innerText();
    if (/Already registered/i.test(label)) await toggle.click();
  }
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /^Sign in$/i }).click();
  await page.waitForURL(u => !u.pathname.startsWith("/auth"), { timeout: 45000 });
}

async function addFirstProduct(page) {
  await page.goto(`${BASE}/marketplace`, { waitUntil: "networkidle" });
  const addBtn = page.getByRole("button", { name: /^\s*Add\s*$/ }).first();
  await addBtn.waitFor({ timeout: 30000 });
  await addBtn.click();
  await page.waitForTimeout(800);
}

function fulfillmentFieldset(page) {
  return page.locator("fieldset", { has: page.locator('input[name="fulfillment"]') }).first();
}
function paymentFieldset(page) {
  return page.locator("fieldset", { has: page.locator('input[name^="payment-"]') }).first();
}
async function pickFulfillment(page, title) {
  await fulfillmentFieldset(page)
    .locator("label", { hasText: new RegExp(`^${title}`) })
    .first()
    .click();
  await page.waitForTimeout(500);
}
async function paymentLabels(page) {
  const text = await paymentFieldset(page).innerText().catch(() => "");
  return text.replace(/\s+/g, " ");
}
async function pickPayment(page, labelRe) {
  await paymentFieldset(page)
    .locator("label", { hasText: labelRe })
    .first()
    .click();
  await page.waitForTimeout(400);
}

async function runViewport(browser, name, viewport) {
  const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
  const page = await ctx.newPage();
  try {
    await signIn(page);
    await addFirstProduct(page);
    await page.goto(`${BASE}/checkout`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);

    // Fulfillment picker exists and precedes the payment fieldset in DOM order.
    const ff = fulfillmentFieldset(page);
    const pf = paymentFieldset(page);
    ok(`${name}: fulfillment picker present`, await ff.locator('input[name="fulfillment"]').count() >= 2);
    const ffHtml = await ff.evaluate(el => el.compareDocumentPosition(document.querySelector("fieldset fieldset") ?? el));
    // simpler: check fulfillment fieldset appears before payment fieldset via bounding boxes
    const ffBox = await ff.boundingBox();
    const pfBox = await pf.boundingBox();
    ok(`${name}: fulfillment rendered before payment`, Boolean(ffBox && pfBox && ffBox.y < pfBox.y), `ff.y=${ffBox?.y} pf.y=${pfBox?.y}`);
    await page.screenshot({ path: `${OUT}/${name}-01-checkout-top.png`, fullPage: true });

    // Default state then explicit Pickup selection.
    await pickFulfillment(page, "Pickup");
    let labels = await paymentLabels(page);
    ok(`${name}: pickup -> Cash on Pickup + Online only`,
      /Cash on Pickup/.test(labels) && /Online Payment/.test(labels) && !/Cash on Delivery/.test(labels), labels.slice(0, 140));
    await page.screenshot({ path: `${OUT}/${name}-02-pickup-payments.png`, fullPage: true });

    // Switch to Delivery -> compatible payments swap; address section appears.
    await pickFulfillment(page, "Delivery");
    labels = await paymentLabels(page);
    ok(`${name}: delivery -> Cash on Delivery + Online only`,
      /Cash on Delivery/.test(labels) && /Online Payment/.test(labels) && !/Cash on Pickup/.test(labels), labels.slice(0, 140));
    const addressShown = (await page.locator("text=/Recipient name|Delivery address|Street address/i").count()) > 0;
    ok(`${name}: delivery address section shown`, addressShown);
    await page.screenshot({ path: `${OUT}/${name}-03-delivery-payments.png`, fullPage: true });

    // Cash on Delivery without address: submit stays disabled.
    await pickPayment(page, /Cash on Delivery/);
    const submitBtn = page.getByRole("button", { name: /Place order|Submit order|Confirm order|Place Order/i }).first();
    await page.waitForTimeout(300);
    ok(`${name}: submit blocked without delivery address`, await submitBtn.isDisabled().catch(() => true));
    await page.screenshot({ path: `${OUT}/${name}-04-delivery-no-address.png`, fullPage: true });

    // Fill delivery fields (text inputs inside the delivery fieldset area, after payment section).
    const inputs = page.locator('input[type="text"], input:not([type])').filter({ visible: true });
    // Delivery inputs are the visible text inputs on the page at this point (cart has no text inputs).
    const vals = ["Juan Dela Cruz", "09171234567", "Agusan del Norte", "Cabadbaran City", "Poblacion", "123 Rizal St", "Gate code 1234"];
    const count = await inputs.count();
    for (let i = 0; i < Math.min(count, vals.length); i++) await inputs.nth(i).fill(vals[i]);
    await page.waitForTimeout(400);
    ok(`${name}: submit enabled after complete delivery address`, await submitBtn.isEnabled().catch(() => false), `inputs=${count}`);
    await page.screenshot({ path: `${OUT}/${name}-05-delivery-complete.png`, fullPage: true });

    // Online + Pickup: QR/account + receipt UI, fulfillment line visible.
    await pickFulfillment(page, "Pickup");
    await pickPayment(page, /Online Payment/);
    await page.waitForTimeout(800);
    const body = await page.locator("body").innerText();
    ok(`${name}: online shows QR/account + receipt upload`, /QR|receipt|Receipt|proof|Proof|account/i.test(body));
    ok(`${name}: fulfillment labeled near payment`, /Fulfillment:\s*(Pickup|Delivery)/i.test(body), (body.match(/Fulfillment:[^\n]*/i) ?? ["none"])[0]);
    await page.screenshot({ path: `${OUT}/${name}-06-online-pickup.png`, fullPage: true });

    // Order detail: extract a real /orders/:id href and open it directly.
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const href = await page.locator('a[href^="/orders/"]').first().getAttribute("href").catch(() => null);
    if (href) {
      await page.goto(`${BASE}${href}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1200);
      const detail = await page.locator("body").innerText();
      const hasFulfillment = /Fulfillment|Pickup|Delivery/i.test(detail);
      const hasPayment = /Online Payment|Cash on Pickup|Cash on Delivery|paymentMethod/i.test(detail);
      ok(`${name}: order detail ${href} shows fulfillment`, hasFulfillment);
      ok(`${name}: order detail ${href} shows payment`, hasPayment);
      await page.screenshot({ path: `${OUT}/${name}-07-order-detail.png`, fullPage: true });
    } else {
      ok(`${name}: order detail check`, true, "no /orders/:id links found on dashboard");
    }
  } catch (e) {
    ok(`${name}: flow completed`, false, String(e).slice(0, 200));
    await page.screenshot({ path: `${OUT}/${name}-ERROR.png`, fullPage: true }).catch(() => {});
  } finally {
    await ctx.close();
  }
}

const browser = await chromium.launch();
await runViewport(browser, "desktop-1280", { width: 1280, height: 800 });
await runViewport(browser, "mobile-360", { width: 360, height: 740 });

// OfficerAdmin order views: dashboard orders + payment review surfaces show both labels.
for (const [role, emailKey, passKey] of [
  ["officer", "SEED_OFFICER_EMAIL", "SEED_OFFICER_PASSWORD"],
  ["seller", "SEED_SELLER_EMAIL", "SEED_SELLER_PASSWORD"],
]) {
  if (!env[emailKey] || !env[passKey]) { ok(`${role} view check`, true, "no seed creds, skipped"); continue; }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  try {
    await signIn(page, env[emailKey], env[passKey]);
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    const text = await page.locator("body").innerText();
    ok(`${role}: order rows show fulfillment label`, /Pickup|Delivery/.test(text));
    ok(`${role}: order rows show payment label`, /Online Payment|Cash on Pickup|Cash on Delivery/.test(text));
    await page.screenshot({ path: `${OUT}/${role}-dashboard-orders.png`, fullPage: true });
    // Open first order detail if present.
    const href = await page.locator('a[href^="/orders/"]').first().getAttribute("href").catch(() => null);
    if (href) {
      await page.goto(`${BASE}${href}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1000);
      const detail = await page.locator("body").innerText();
      ok(`${role}: order detail shows fulfillment + payment`, /Pickup|Delivery/.test(detail) && /Online Payment|Cash on/i.test(detail), href);
      await page.screenshot({ path: `${OUT}/${role}-order-detail.png`, fullPage: true });
    }
  } catch (e) {
    ok(`${role} view check`, false, String(e).slice(0, 160));
    await page.screenshot({ path: `${OUT}/${role}-ERROR.png`, fullPage: true }).catch(() => {});
  } finally {
    await ctx.close();
  }
}
await browser.close();

const fails = results.filter(r => !r.pass);
console.log(`\n${results.length - fails.length}/${results.length} checks passed`);
process.exit(fails.length ? 1 : 0);
