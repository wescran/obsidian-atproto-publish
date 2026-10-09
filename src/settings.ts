import { type App, PluginSettingTab, SecretComponent, Setting } from 'obsidian';

import type AtprotoPublishPlugin from './main.ts';

export interface PublishSettings {
	/** Handle or DID to log in as. The PDS is found from it. */
	identifier: string;
	/** Name of the SecretStorage entry holding the app password (never the password itself) */
	passwordSecret: string;
	/** Vault folder whose notes can be published */
	articlesFolder: string;
	/** Document path, relative to the publication URL. Must contain {slug}. */
	pathTemplate: string;
	/** AT-URI of the site.standard.publication record. Its `url` is the site URL. */
	publicationUri: string;
}

export const DEFAULT_SETTINGS: PublishSettings = {
	identifier: '',
	passwordSecret: '',
	articlesFolder: 'articles',
	pathTemplate: '/{slug}',
	publicationUri: '',
};

type TextKey = Exclude<keyof PublishSettings, 'passwordSecret'>;

export class PublishSettingTab extends PluginSettingTab {
	plugin: AtprotoPublishPlugin;

	constructor(app: App, plugin: AtprotoPublishPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.addText('Handle', 'Your atproto handle or DID, e.g. alice.example.com.', 'identifier', 'alice.example.com');

		new Setting(containerEl)
			.setName('App password')
			.setDesc('Choose or create a secret holding an app password. Only its name is stored in the plugin settings.')
			.addComponent((el) =>
				new SecretComponent(this.app, el).setValue(this.plugin.settings.passwordSecret).onChange(async (value) => {
					this.plugin.settings.passwordSecret = value;
					await this.plugin.saveSettings();
				}),
			);

		this.addText('Articles folder', 'Only notes in this folder can be published.', 'articlesFolder', 'articles');
		this.addText(
			'Path template',
			'Where articles live on your site. Must contain {slug}, e.g. /articles/{slug}.',
			'pathTemplate',
			'/{slug}',
		);
		this.addText(
			'Publication',
			'AT-URI of your site.standard.publication record.',
			'publicationUri',
			'at://did:plc:…/site.standard.publication/…',
		);
	}

	private addText(name: string, desc: string, key: TextKey, placeholder: string): void {
		new Setting(this.containerEl)
			.setName(name)
			.setDesc(desc)
			.addText((text) =>
				text
					.setPlaceholder(placeholder)
					.setValue(this.plugin.settings[key])
					.onChange(async (value) => {
						this.plugin.settings[key] = value.trim();
						await this.plugin.saveSettings();
					}),
			);
	}
}
