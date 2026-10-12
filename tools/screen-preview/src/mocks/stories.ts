import { covers } from "./images";
export function mediaFileUrl(id: string) { return covers[id] ?? ""; }
export async function getMyActiveStories() { return { stories: new URLSearchParams(location.search).get("story") === "none" ? [] : [{ id: "s1" }] }; }
export async function getUserActiveStories(name: string) { return { stories: name === "asha_k" ? [{ id: "s2" }] : [] }; }
