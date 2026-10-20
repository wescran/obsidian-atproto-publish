import { debounce } from 'obsidian';

import { PublishError } from './convert/document.ts';
import { noteStatus, statusLabel } from './convert/status.ts';
import type AtprotoPublishPlugin from './main.ts';

const REFRESH_DELAY_MS = 500;

/** The active note's publish status. Clicking it publishes. Desktop only. */
export class StatusBar {
	private readonly el: HTMLElement;
	private refreshes = 0;

	constructor(private readonly plugin: AtprotoPublishPlugin) {
		this.el = plugin.addStatusBarItem();
	}

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
		// Fires on every save while typing, and after publish() updates the frontmatter.
		const refreshSoon = debounce(() => void this.refresh(), REFRESH_DELAY_MS, true);
		this.plugin.registerEvent(
			this.plugin.app.metadataCache.on('changed', (file) => {
				if (file === this.plugin.app.workspace.getActiveFile()) refreshSoon();
			}),
		);
		void this.refresh();
	}

	/** Hides the item for notes that can't be published or can't be read. */
	async refresh(): Promise<void> {
		// Refreshes can overlap; only the latest may update the item.
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
