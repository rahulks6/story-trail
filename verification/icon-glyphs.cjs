// The spec's icon rule (sections 42-43): controls use Katkee's own vector icon family
// (components/Icon.tsx), never emoji or Unicode symbols. Emoji are allowed only where they
// are what people post or send: Story stickers, the DM emoji picker, and the friendly
// empty-state lines. Any other symbol glyph in the app's source fails here (the Story
// editor's publish button used "✓" until it got the check icon).
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const src=path.join(__dirname,'../mobile/src');

// Arrows, dingbats, miscellaneous symbols, check marks, bullets and the midline ellipsis (both
// common stand-ins for a "more" icon), and emoji. The ordinary ellipsis is punctuation.
const GLYPH=/[\u2190-\u21FF\u2022\u22EF\u2600-\u27BF\u2B50\u2B55]|[\uD83C-\uD83E][\uDC00-\uDFFF]/;

/** Content, not controls: [file, pattern the line must match]. */
const CONTENT=[
 ['components/StickerSheet.tsx',/EMOJI_SET = \[/],
 ['components/OverlayBody.tsx',/^\s*("?[a-z-]+"?): "[^"]+",$/],
 ['components/OverlayBody.tsx',/STICKER_GLYPHS\[overlay\.properties\.stickerId\] \?\? "✦"/],
 ['components/OverlayBody.tsx',/<Text style=\{styles\.chip\}>📍 \{overlay\.properties\.label\}<\/Text>/],
 ['screens/dm/ConversationScreen.tsx',/^\s*("[^"]+",\s*)+$/],
 ['screens/dm/ConversationScreen.tsx',/Say hi to @\$\{otherUsername\} 👋` : "Say hi 👋"/],
 ['screens/dm/DMInboxScreen.tsx',/return "Say hi 👋";/],
 ['screens/auth/ProviderEntry.tsx',/\$\{country\} •••• \$\{phone/],
];

function glyphLines(files){
 const out=[];
 for(const [file,code] of Object.entries(files))code.split('\n').forEach((line,i)=>{
  const t=line.trim();
  if(t.startsWith('//')||t.startsWith('*')||t.startsWith('/*')||!GLYPH.test(line))return;
  if(CONTENT.some(([f,pattern])=>f===file&&pattern.test(line)))return;
  out.push(`${file}:${i+1}: ${t.slice(0,100)}`);
 });
 return out;
}

function sources(){
 const files={};
 (function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  const p=path.join(dir,e.name);
  if(e.isDirectory())walk(p);else if(/\.tsx?$/.test(e.name))files[path.relative(src,p).split(path.sep).join('/')]=fs.readFileSync(p,'utf8');
 }})(src);
 return files;
}

test('controls draw icons from the icon family, never emoji or symbol glyphs',()=>{
 assert.deepEqual(glyphLines(sources()),[]);
});

test('the check catches a glyph in a control and allows posted content',()=>{
 assert.deepEqual(glyphLines({'screens/create/StoryEditorScreen.tsx':'<Text>{done ? "Story published ✓" : "Share"}</Text>'}),['screens/create/StoryEditorScreen.tsx:1: <Text>{done ? "Story published ✓" : "Share"}</Text>']);
 assert.deepEqual(glyphLines({'screens/home/X.tsx':'<Text>❤</Text>','screens/home/Y.tsx':'<Text>→ Next</Text>'}).length,2);
 assert.deepEqual(glyphLines({'components/StickerSheet.tsx':'const EMOJI_SET = ["😀", "😂"];'}),[]);
 assert.deepEqual(glyphLines({'screens/x.tsx':'// a comment may say ✓'}),[]);
});
