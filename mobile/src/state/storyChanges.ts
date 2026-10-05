const listeners=new Set<()=>void>();
export function storyPublished(){listeners.forEach(fn=>fn());}
export function onStoryPublished(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener);};}
