import { Plugin } from 'obsidian';

import { Publisher } from './publisher.ts';
import { DEFAULT_SETTINGS, type PublishSettings, PublishSettingTab } from './settings.ts';

export default class AtprotoPublishPlugin extends Plugin {
	settings: PublishSettings = { ...DEFAULT_SETTINGS };
	readonly publisher = new Publisher(this);

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new PublishSettingTab(this.app, this));

		this.addCommand({
			id: 'publish',
			name: 'Publish document',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!this.publisher.canPublish(file)) return false;
				if (!checking) void this.publisher.run(() => this.publisher.publish(file));
				return true;
			},
		});
		this.addCommand({
			id: 'unpublish',
			name: 'Unpublish document',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!this.publisher.canPublish(file)) return false;
				if (!checking) void this.publisher.run(() => this.publisher.unpublish(file));
				return true;
			},
		});

		// TODO (Task 8): create the status bar and wire it up:
		//   new StatusBar(this).register();
		// (import it from './status-bar.ts'). Keep it in a field if you'd like to
		// refresh it from elsewhere later, e.g. when the documents folder setting changes.
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
