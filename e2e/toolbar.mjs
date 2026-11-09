// How the scripts drive the toolbar's panels. The filter facets, the display options and
// import/export each sit behind one button, so a step that used to click a visible control
// now opens its panel first.

/** Opens the "Bộ lọc" panel unless it is already open. */
export async function openFilterPanel(page) {
  if (!(await page.locator(".tf-filter-menu").count())) await page.locator(".tf-add").first().click();
}

/**
 * Switches one of the quick filters ("Của tôi", "Quá hạn", "Chưa có ngày", "Bị chặn") in the top of the
 * "Bộ lọc" panel and closes the panel. They are chips while on, so `quickIsOn` reads the chip.
 */
export async function quickFilter(page, label) {
  await openFilterPanel(page);
  await page.locator(".tf-quick-row", { hasText: label }).first().click();
  await page.keyboard.press("Escape");
}

/** Whether a quick filter is on: its chip is on the active line. `key` is mine / overdue / unscheduled / blocked / sla. */
export async function quickIsOn(page, key) {
  return (await page.locator(`.tf-active .tf-chip[data-quick="${key}"]`).count()) > 0;
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

/** Opens the "⋯" menu at the end of the Gantt toolbar (group all, display options, import / export, shortcuts) unless open. */
export async function openMore(page) {
  if (!(await page.locator(".more-menu").count())) {
    await page.locator(".gantt-toolbar button[aria-label='Thêm']").click();
    await page.waitForSelector(".more-menu");
  }
}

/** Opens the display options (chart switches and table columns): they are a section of the "⋯" menu. */
export async function openDisplay(page) {
  await openMore(page);
}

/** One row of the "Hiển thị" panel's switches. */
export function displaySwitch(page, label) {
  return page.locator(".view-menu .switch-row", { hasText: label }).locator("input");
}

/** Clicks an entry of the "Nhập / Xuất" menu ("Nhập việc", "Nhập KBKT", "Xuất CSV"). */
export async function ioAction(page, label) {
  await openMore(page);
  await page.locator(".io-menu button", { hasText: label }).click();
}

/**
 * Opens a lens by its label. The lenses are the views inside Dự án, so on Hôm nay or the settings page
 * (where they are not drawn) the rail's Dự án comes first.
 */
export async function openLens(page, label) {
  const lens = page.locator(".lens-tabs button", { hasText: label });
  if (!(await lens.count())) {
    await page.locator(".rail-btn[data-view=plan]").click();
    await page.waitForSelector(".lens-tabs");
  }
  await lens.click();
}

/** Clockwork (the hours logged): a place of its own on the rail. */
export async function openTimesheet(page, { wait = true } = {}) {
  await page.locator(".rail-btn[data-view=timesheet]").click();
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
