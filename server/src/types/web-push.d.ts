// web-push ships no type declarations; the service only uses the minimal
// send() surface via dynamic import, so an ambient module declaration is
// sufficient until a typed wrapper is introduced.
declare module "web-push";
