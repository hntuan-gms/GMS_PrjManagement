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
