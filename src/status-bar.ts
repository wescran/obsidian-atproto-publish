import { debounce } from 'obsidian';

import { PublishError } from './convert/document.ts';
import { noteStatus, statusLabel } from './convert/status.ts';
import type AtprotoPublishPlugin from './main.ts';

const REFRESH_DELAY_MS = 500;

/**
 * The status bar item: **Draft**, **Published** or **Published · edited** for
 * the active note, when it's one the plugin can publish (`canPublish`).
 * Clicking it runs "Publish document". (Obsidian has no status bar on mobile,
 * so there it simply never shows.)
 */
export class StatusBar {
	private readonly el: HTMLElement;
	private refreshes = 0;

	constructor(private readonly plugin: AtprotoPublishPlugin) {
		this.el = plugin.addStatusBarItem();
	}

	/**
	 * Call once from `onload`. Wires everything up with the plugin's
	 * `register*` methods, so Obsidian removes it all when the plugin unloads:
	 *
	 * 1. `this.el.addClass('mod-clickable')` (Obsidian's pointer cursor and hover
	 *    style for status bar items).
	 * 2. `plugin.registerDomEvent(this.el, 'click', …)`: if the active file
	 *    `canPublish`, run `publisher.run(() => publisher.publish(file))`.
	 * 3. `workspace.on('active-leaf-change', …)` → `refresh()` straight away,
	 *    so switching notes updates the item without a delay.
	 * 4. `metadataCache.on('changed', (file) => …)` → when `file` is the active
	 *    file, a refresh **debounced** by `REFRESH_DELAY_MS`:
	 *    `debounce(() => this.refresh(), REFRESH_DELAY_MS, true)`. It fires
	 *    after every save while typing, and also after `publish()` writes the
	 *    frontmatter, which is what turns the item to Published.
	 * 5. Wrap each `workspace.on`/`metadataCache.on` in `plugin.registerEvent(…)`.
	 * 6. `refresh()` once, for the note that's open when the plugin loads.
	 */
	register(): void {
		this.el.addClass('mod-clickable');
		this.plugin.registerDomEvent(this.el, 'click', () => {
			const file = this.plugin.app.workspace.getActiveFile();
			if (this.plugin.publisher.canPublish(file)) {
				void this.plugin.publisher.run(() => this.plugin.publisher.publish(file));
			}
		});
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('active-leaf-change', () => {
				void this.refresh();
			}),
		);
		const refreshSoon = debounce(() => void this.refresh(), REFRESH_DELAY_MS, true);
		this.plugin.registerEvent(
			this.plugin.app.metadataCache.on('changed', (file) => {
				if (file === this.plugin.app.workspace.getActiveFile()) refreshSoon();
			}),
		);
		void this.refresh();
	}

	/**
	 * Recomputes the item for the active file.
	 *
	 * - Not publishable (`canPublish` is false, including no file) →
	 *   `this.el.hide()`.
	 * - Otherwise `publisher.readNote(file)` → `noteStatus(…)` →
	 *   `this.el.setText(statusLabel(status))` and `this.el.show()`.
	 * - Reading fails with a `PublishError` (broken YAML) → hide, rather than
	 *   guess a status. Publishing explains the problem when the author tries.
	 *   Any other error is a bug: hide, and `console.error` it.
	 * - **Refreshes can overlap** (reading and hashing are async, and the
	 *   author can switch notes meanwhile). Only the most recent call may change
	 *   the item: count calls in a field, and ignore a result if another call
	 *   started after it.
	 */
	async refresh(): Promise<void> {
		const call = ++this.refreshes;
		const file = this.plugin.app.workspace.getActiveFile();
		if (!this.plugin.publisher.canPublish(file)) {
			this.el.hide();
			return;
		}
		try {
			const note = await this.plugin.publisher.readNote(file);
			if (call !== this.refreshes) return;
			const status = await noteStatus(note.frontmatter, file.basename, note.body);
			if (call !== this.refreshes) return;
			this.el.setText(statusLabel(status));
			this.el.show();
		} catch (error) {
			if (!(error instanceof PublishError)) console.error('ATproto Publish:', error);
			if (call === this.refreshes) this.el.hide();
		}
	}
}

