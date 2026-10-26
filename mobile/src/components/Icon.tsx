import React from 'react';
import {StyleSheet, View, type StyleProp, type TextStyle} from 'react-native';
import Svg, {Path, Circle, Rect, G} from 'react-native-svg';
import {colors} from '../theme/colors';
import type {IconName} from '../theme/icons';

/** Reconstructed from the approved board (master spec p2), in a 24-unit grid.
 * Decorative by default: the owning control supplies its accessible label/state.
 */
export function Icon({name,size,color,selected=false,style}: {name:IconName;size?:number;color?:string;selected?:boolean;style?:StyleProp<TextStyle>}): React.JSX.Element {
 const flat=StyleSheet.flatten(style)||{};
 const length=size??flat.fontSize??24;
 const ink=color??(selected?colors.accentText:flat.color)??colors.textPrimary;
 const filled=name==='liked'||name==='starFilled'||name==='verified'||(name==='home'&&selected);
 const paths:Partial<Record<IconName,string>>={
  home:'M4 10.5 12 3l8 7.5V21h-5v-7H9v7H4Z',
  search:'M16 16 21 21',
  create:'M12 5v14M5 12h14',add:'M12 5v14M5 12h14',
  like:'M12 21S2 15 2 8.7C2 3.4 8.5 2 12 6.5 15.5 2 22 3.4 22 8.7C22 15 12 21 12 21Z',
  dm:'M5 4h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H8l-5 3V6a2 2 0 0 1 2-2Z',
  comment:'M21 11.5a9 9 0 0 1-9 9 10 10 0 0 1-4-.9L3 22l1.4-5.5A9 9 0 1 1 21 11.5Z',
  share:'M2 10 22 2l-7 20-4-9-9-3Zm9 3L22 2',
  close:'M5 5l14 14M19 5 5 19',
  flash:'M13 2 5 13h6l-1 9 9-13h-7Z',
  timer:'M12 2v4m5-2a9 9 0 1 1-10 0M12 8v5l3 2',
  gallery:'M3 17l6-6 5 5 3-3 4 4',
  flip:'M3 9a9 9 0 0 1 16-3l2 3M17 9h4V5M21 15A9 9 0 0 1 5 18l-2-3m0 4v-4h4',
  text:'M2 19 7 5l5 14M4 14h6M21 19v-7c-4-4-9 3-4 5 1 1 3 0 4-2',
  draw:'M2 16c3-10 5 8 9-4s6 10 11-7',
  audioOn:'M3 9h4l5-5v16l-5-5H3ZM16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14',
  audioMuted:'M3 9h4l5-5v16l-5-5H3ZM16 9l6 6m0-6-6 6',
  crop:'M6 2v16h16M2 6h16v16',
  viewers:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z',
  insights:'M5 21V12m7 9V3m7 18V8',
  back:'M15 3l-9 9 9 9',
  newChat:'M13 4H5a2 2 0 0 0-2 2v14a1 1 0 0 0 1 1h14a2 2 0 0 0 2-2v-8M10 14l1-5 9-8 3 3-9 9-4 1Z',
  attach:'M9 4h6a3 3 0 0 1 3 3v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7a3 3 0 0 1 3-3ZM10 8h4v7h-4Z',
  notifications:'M5 17c2-3 1-5 2-9 1-6 9-6 10 0 1 4 0 6 2 9H5Zm5 4h4',
  trash:'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 9v9m4-9v9',
  check:'M5 12l4 4L19 6',
  edit:'M3 21l1-6L17 2l5 5L9 20l-6 1ZM14 5l5 5',
  undo:'M3 9h11a6 6 0 0 1 0 12M3 9l6-6m-6 6 6 6',
  reply:'M10 5 3 12l7 7M3 12h9a9 9 0 0 1 9 9',
  copy:'M9 9h11v12H9ZM5 15H4V4h11v1',
  report:'M5 21V4h12l-2.5 4L17 12H5',
  redo:'M21 9H10a6 6 0 0 0 0 12M21 9l-6-6m6 6-6 6',
  logout:'M10 3H3v18h7m-2-9h14m-5-5 5 5-5 5',
  star:'m12 2 3 6 7 1-5 5 1 8-6-4-6 4 1-8-5-5 7-1Z',
  settings:'m9 2-1 3-3 1-3 4 2 2-1 3 3 4 3-1 3 2 3-2 3 1 3-4-1-3 2-2-3-4-3-1-1-3Z',
  archive:'M3 9a9 9 0 1 1 0 8M3 3v6h6M12 7v6l4 2',
  save:'M12 2v14m-5-5 5 5 5-5M4 18v3h16v-3',
  privacy:'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v12H5Z',
  help:'M9 8c0-4 7-4 7 0 0 3-4 2-4 6m0 3v.1',
  about:'M12 10v7m0-10v.1',
  following:'M3 22v-3a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v3m1-11h6m-3-3v6',
  mention:'M16 8v7c0 3 6 2 6-4A10 10 0 1 0 18 20M16 10c-4-6-10 4-5 6 4 2 5-6 5-6',
  filter:'M3 6h5m5 0h8M3 12h11m5 0h2M3 18h3m5 0h10',
  alignLeft:'M4 6h16M4 10h10M4 14h16M4 18h10',alignCenter:'M4 6h16M7 10h10M4 14h16M7 18h10',alignRight:'M4 6h16M10 10h10M4 14h16M10 18h10',textBackground:'M3 4h18v16H3zM8 16l4-9 4 9M9.5 13h5',music:'M9 18V5l12-2v13',camera:'M3 8a2 2 0 0 1 2-2h2.5l1.5-2h6l1.5 2H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z',mic:'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3ZM5 11a7 7 0 0 0 14 0M12 18v3',play:'M7 4v16l13-8Z',pause:'M8 5v14M16 5v14',
  // Forward: an arrow bending on to the right. Pin: a push pin, upright.
  forward:'M14 5l7 7-7 7M21 12H10a6 6 0 0 0-6 6v1',
  pin:'M9 3h6M10 3v6l-4 4v2h12v-2l-4-4V3M12 15v6',
  // A rosette (eight scallops) with the tick cut out of it in the background's contrast colour.
  verified:'M12 1.8L15.2 4.2L19.2 4.8L19.8 8.8L22.2 12L19.8 15.2L19.2 19.2L15.2 19.8L12 22.2L8.8 19.8L4.8 19.2L4.2 15.2L1.8 12L4.2 8.8L4.8 4.8L8.8 4.2Z',
  chevron:'M9 5l7 7-7 7',minus:'M5 12h14',up:'M12 21V3m-7 7 7-7 7 7',down:'M12 3v18m-7-7 7 7 7-7',left:'M21 12H3m7-7-7 7 7 7',right:'M3 12h18m-7-7 7 7-7 7',
 };
 const alias:Partial<Record<IconName,IconName>>={activity:'like',liked:'like',clear:'close',send:'share',changeCover:'gallery',starFilled:'star'};
 const key=alias[name]??name;
 return <View pointerEvents="none" accessible={false} style={{margin:flat.margin,marginTop:flat.marginTop,marginBottom:flat.marginBottom,marginLeft:flat.marginLeft,marginRight:flat.marginRight}}>
  <Svg width={length} height={length} viewBox="0 0 24 24" accessible={false}>
   <G stroke={ink} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill={filled?ink:'none'}>
    {paths[key]&&<Path d={paths[key]}/>}
    {key==='search'&&<Circle cx={10.5} cy={10.5} r={7.5}/>}
    {key==='gallery'&&<><Rect x={2} y={3} width={20} height={18} rx={2}/><Circle cx={7} cy={7} r={1}/></>}
    {key==='capture'&&<><Circle cx={12} cy={12} r={11}/><Circle cx={12} cy={12} r={8.5} fill={ink}/></>}
    {key==='viewers'&&<Circle cx={12} cy={12} r={3}/>}
    {(key==='profile'||key==='following')&&<><Circle cx={key==='following'?9:12} cy={6} r={4}/>{key==='profile'&&<Path d="M4 22v-3a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v3"/>}</>}
    {(key==='emoji'||key==='sticker')&&<><Circle cx={12} cy={12} r={9}/><Path d="M8 14c1 4 7 4 8 0"/><Circle cx={8.5} cy={9} r={.6} fill={ink}/><Circle cx={15.5} cy={9} r={.6} fill={ink}/></>}
    {key==='more'&&[4,12,20].map(cx=><Circle key={cx} cx={cx} cy={12} r={1.5} fill={ink}/>)}
    {key==='settings'&&<Circle cx={12} cy={11} r={3}/>}
    {(key==='help'||key==='about')&&<Circle cx={12} cy={12} r={10}/>}
    {key==='data'&&<><Path d="M4 6c0-5 16-5 16 0v13c0 5-16 5-16 0V6Zm0 0c0 5 16 5 16 0M4 12c0 5 16 5 16 0"/></>}
    {key==='camera'&&<Circle cx={12} cy={13} r={3.5}/>}
    {key==='music'&&<><Circle cx={6} cy={18} r={3}/><Circle cx={18} cy={16} r={3}/></>}
    {key==='verified'&&<Path d="M8 12.2l2.8 2.8L16.2 9.4" stroke={colors.onAccentText} strokeWidth={2.2} fill="none"/>}
    {key==='filter'&&<><Circle cx={10.5} cy={6} r={2.5}/><Circle cx={16.5} cy={12} r={2.5}/><Circle cx={8.5} cy={18} r={2.5}/></>}
   </G>
  </Svg>
 </View>;
}
