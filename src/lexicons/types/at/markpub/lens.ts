import type {} from '@atcute/lexicons';
import * as v from '@atcute/lexicons/validations';

const _mainSchema = /*#__PURE__*/ v.object(
	{
		"$type": /*#__PURE__*/ v.optional(/*#__PURE__*/ v.literal("at.markpub.lens")),
		/**
		 * A list of facet types that this lens can translate bidirectionally between. For example, if you include `pub.leaflet.richtext.facet#bold` and `at.markpub.facet#strong` then this lens can be used to translate between those two facet types and any renderer that understands either of those facet types can use this lens to render the facets it understands.
		 */
		get "facets"() {
			return /*#__PURE__*/ v.array(/*#__PURE__*/ v.variant([]))
		},
		/**
		 * You may include code here intended to process a string with the provided facets. This is optional and not expected to be used by most lenses, but it can be helpful for testing or for providing examples of how a renderer might use the lens.
		 */
		"outputCode": /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
		/**
		 * A human-readable description of what the output of this lens is intended to be. This is optional but can be helpful for documentation purposes and for anyone trying to understand how to use the lens.
		 */
		"outputDescription": /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
		"outputTargetHTML": /*#__PURE__*/ v.optional(/*#__PURE__*/ v.string()),
	}
);
type main$schematype = typeof _mainSchema;

export interface mainSchema extends main$schematype {}
export const mainSchema = _mainSchema as mainSchema;

export interface Main extends v.InferInput<typeof mainSchema> {}
