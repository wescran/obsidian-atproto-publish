import { Plugin, type TFile } from 'obsidian';

import { Publisher } from './publisher.ts';
import { DEFAULT_SETTINGS, type PublishSettings, PublishSettingTab } from './settings.ts';
import { StatusBar } from './status-bar.ts';

export default class AtprotoPublishPlugin extends Plugin {
	settings: PublishSettings = { ...DEFAULT_SETTINGS };
	readonly publisher = new Publisher(this);

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new PublishSettingTab(this.app, this));

		this.addDocumentCommand('publish', 'Publish document', (file) => this.publisher.publish(file));
		this.addDocumentCommand('unpublish', 'Unpublish document', (file) => this.publisher.unpublish(file));
		new StatusBar(this).register();
	}

	/** A command that's only available for notes in the documents folder. */
	private addDocumentCommand(id: string, name: string, action: (file: TFile) => Promise<void>): void {
		this.addCommand({
			id,
			name,
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!this.publisher.canPublish(file)) return false;
				if (!checking) void this.publisher.run(() => action(file));
				return true;
			},
		});
	}

	async loadSettings(): Promise<void> {
		const saved = (await this.loadData()) as Partial<PublishSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS };
		for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof PublishSettings>) {
			const value = saved?.[key];
			if (typeof value === 'string') this.settings[key] = value;
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
