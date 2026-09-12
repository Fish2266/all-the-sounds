/* ============================================================================
   Texture pack — deliberately empty.

   ui/textures.js is shared byte-for-byte with Frame & Groove, where a bundled
   texture set can stand in for the generated block surfaces. All The Sounds
   ships no textures at all, so this module answers "no" to everything and the
   chrome wears the generated stone and deepslate instead.
   ========================================================================= */

export const hasTexture = () => false;
export const textureURL = () => null;
export const decodeTexture = async () => null;
export const textureCanvasSync = () => null;
