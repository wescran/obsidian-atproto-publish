import { type App, PluginSettingTab, SecretComponent, Setting } from 'obsidian';

import type CranlabPublishPlugin from './main.ts';

export interface PublishSettings {
	/** PDS base URL, e.g. https://weslandia.ca */
	service: string;
	/** Handle or DID used to log in */
	identifier: string;
	/** Name of the SecretStorage entry holding the app password (never the password itself) */
	passwordSecret: string;
	/** Vault folder whose notes can be published */
	articlesFolder: string;
	/** Public site URL that article paths are relative to */
	siteUrl: string;
	/** AT-URI of the site.standard.publication record */
	publicationUri: string;
}

export const DEFAULT_SETTINGS: PublishSettings = {
	service: 'https://weslandia.ca',
	identifier: 'cranlab.ca',
	passwordSecret: '',
	articlesFolder: 'articles',
	siteUrl: 'https://cranlab.ca',
	publicationUri: '',
};

type TextKey = Exclude<keyof PublishSettings, 'passwordSecret'>;

export class PublishSettingTab extends PluginSettingTab {
	plugin: CranlabPublishPlugin;

	constructor(app: App, plugin: CranlabPublishPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.addText('PDS URL', 'Where your account is hosted.', 'service');
		this.addText('Handle', 'Your handle or DID.', 'identifier');

		new Setting(containerEl)
			.setName('App password')
			.setDesc('Choose or create a secret holding an app password. Only its name is stored in the plugin settings.')
			.addComponent((el) =>
				new SecretComponent(this.app, el).setValue(this.plugin.settings.passwordSecret).onChange(async (value) => {
					this.plugin.settings.passwordSecret = value;
					await this.plugin.saveSettings();
				}),
			);

		this.addText('Articles folder', 'Only notes in this folder can be published.', 'articlesFolder');
		this.addText('Site URL', 'Public URL that article paths are relative to.', 'siteUrl');
		this.addText('Publication', 'AT-URI of your site.standard.publication record.', 'publicationUri');
	}

	private addText(name: string, desc: string, key: TextKey): void {
		new Setting(this.containerEl)
			.setName(name)
			.setDesc(desc)
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS[key])
					.setValue(this.plugin.settings[key])
					.onChange(async (value) => {
						this.plugin.settings[key] = value.trim();
						await this.plugin.saveSettings();
					}),
			);
	}
}
