import { Plugin } from 'obsidian';

import { DEFAULT_SETTINGS, type PublishSettings, PublishSettingTab } from './settings.ts';

export default class CranlabPublishPlugin extends Plugin {
	settings: PublishSettings = { ...DEFAULT_SETTINGS };

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new PublishSettingTab(this.app, this));
	}

	async loadSettings(): Promise<void> {
		const saved = (await this.loadData()) as Partial<PublishSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...saved };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
