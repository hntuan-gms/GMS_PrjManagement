// How the scripts drive the toolbar's panels. The filter facets, the display options and
// import/export each sit behind one button, so a step that used to click a visible control
// now opens its panel first.

/** Opens the "Bộ lọc" panel unless it is already open. */
export async function openFilterPanel(page) {
  if (!(await page.locator(".tf-filter-menu").count())) await page.locator(".tf-add").first().click();
}

/**
 * Ticks one value of one facet ("Trạng thái" → "In Progress") and closes the panel again.
 * `value` may be a RegExp when a plain substring would match several ("High" vs "Highest").
 */
export async function pickFacet(page, label, value) {
  await openFilterPanel(page);
  const head = page.locator(".tf-facet-head", { hasText: label });
  if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
  await page.locator(".tf-menu .col-chooser-item", { hasText: value }).first().click();
  await page.keyboard.press("Escape");
}

/** Opens the "Hiển thị" panel (chart switches and table columns) unless it is already open. */
export async function openDisplay(page) {
  if (!(await page.locator(".view-menu").count())) {
    await page.locator(".gantt-toolbar button", { hasText: "Hiển thị" }).click();
  }
}

/** One row of the "Hiển thị" panel's switches. */
export function displaySwitch(page, label) {
  return page.locator(".view-menu .switch-row", { hasText: label }).locator("input");
}

/** Clicks an entry of the "Nhập / Xuất" menu ("Nhập công việc", "Nhập KBKT", "Xuất CSV"). */
export async function ioAction(page, label) {
  await page.locator(".gantt-toolbar button", { hasText: "Nhập / Xuất" }).click();
  await page.locator(".io-menu button", { hasText: label }).click();
}

/** Nhân lực in its "Giờ đã ghi" mode (what the rail's "Giờ làm" used to open): lens, then the mode switch. */
export async function openTimesheet(page, { wait = true } = {}) {
  if (!(await page.locator("[data-lens=resource][aria-current=page]").count())) await page.locator("[data-lens=resource]").click();
  await page.locator("[data-mode=ts]").click();
  if (wait) await page.waitForSelector(".ts-grid");
}

/**
 * Cài đặt dự án, on a section ("Lịch làm việc", "SLA", "Nhập KBKT"; none = whatever it opens on).
 * Goes through the project menu unless the page is already up.
 */
export async function openSettings(page, section) {
  if (!(await page.locator(".settings-page").count())) {
    await page.locator(".project-switch").click();
    await page.locator("[role=menuitem]", { hasText: "Cài đặt dự án" }).click();
    await page.waitForSelector(".settings-page");
  }
  if (section) {
    await page.locator(".settings-nav-item", { hasText: section }).click();
    await page.waitForSelector(".settings-body h2", { hasText: section });
  }
}

/** Types a date into a DateField ("2026-11-15" is written as 15/11/2026) and commits it with Enter. */
export async function fillDate(locator, iso) {
  await locator.fill(`${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`);
  await locator.press("Enter");
}

/** Nhân lực's "Ngày | Tuần | Tháng" switch (it replaced the "Cột" select): `g` is "day", "week" or "month". */
export async function setGranularity(page, g) {
  await page.locator(`.rv-granularity [data-g=${g}]`).click();
}

/** Which of Ngày / Tuần / Tháng is on, as "day" | "week" | "month". */
export async function granularityOf(page) {
  return page.locator(".rv-granularity [aria-pressed=true]").getAttribute("data-g");
}
