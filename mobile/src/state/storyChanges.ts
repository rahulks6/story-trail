const listeners=new Set<()=>void>();
export function storyPublished(){listeners.forEach(fn=>fn());}
export function onStoryPublished(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener);};}
/** Your name, username, bio or photo changed (Edit Profile): screens showing them reload. */
const profileListeners=new Set<()=>void>();
export function profileChanged(){profileListeners.forEach(fn=>fn());}
export function onProfileChanged(listener:()=>void){profileListeners.add(listener);return ()=>{profileListeners.delete(listener);};}
