export function slugify(name: string): string {
	return name
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '') // strip accents
		.toLowerCase()
		.replace(/['’]/g, '') // drop apostrophes: "it's" → "its"
		.replace(/[^a-z0-9]+/g, '-') // every other run of non-alphanumerics → "-"
		.replace(/^-+|-+$/g, ''); // trim dashes from both ends
}
