import {Icon} from "../../components/Icon";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image, Linking, Modal, ScrollView, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Video from 'react-native-video';
import { API_BASE_URL } from '../../api/client';
import { adCtaAction, recordAd, reportAd, validateAd, type SponsoredPlacement } from '../../api/ads';
import { useAuth } from '../../state/AuthContext';
interface Props {
    ad: SponsoredPlacement;
    active: boolean;
    onNext: () => void;
    onPrevious: () => void;
    onHide: (id: string) => void;
    /** The View Profile CTA opens the advertiser's Katkee profile. */
    onOpenProfile?: (username: string) => void;
}
export function SponsoredStory({ ad, active, onNext, onPrevious, onHide, onOpenProfile }: Props): React.JSX.Element {
    const { accessToken } = useAuth();
    const [valid, setValid] = useState(false), [ready, setReady] = useState(false), [paused, setPaused] = useState(false), [menu, setMenu] = useState<false | "options" | "report">(false);
    const visible = useRef(0), sent = useRef(new Set<string>()), left = useRef(false);
    const callbacks = useRef({ onNext, onPrevious, onHide });
    callbacks.current = { onNext, onPrevious, onHide };
    const emit = (event: string) => { if (!accessToken || sent.current.has(event))
        return; sent.current.add(event); recordAd(ad.deliveryId, event, visible.current, accessToken); };
    const leave = (back = false) => { if (left.current)
        return; left.current = true; (back ? callbacks.current.onPrevious : callbacks.current.onNext)(); };
    const fail = () => { emit('ad_load_failed'); callbacks.current.onHide(ad.creativeId); leave(); };
    useEffect(() => {
        if (!accessToken) {
            leave();
            return;
        }
        let cancelled = false;
        void validateAd(ad.deliveryId, accessToken).then(() => { if (!cancelled)
            setValid(true); }).catch(() => { if (!cancelled)
            fail(); });
        return () => { cancelled = true; };
    }, [ad.deliveryId, accessToken]);
    // Inventory is optional. A slow/failed creative must yield promptly to organic content.
    useEffect(() => { if (ready || !active)
        return; const timer = setTimeout(fail, 800); return () => clearTimeout(timer); }, [ready, active]);
    useEffect(() => {
        if (!ready || !active || paused || menu)
            return;
        emit('ad_rendered');
        let last = Date.now();
        const timer = setInterval(() => {
            const now = Date.now();
            visible.current += now - last;
            last = now;
            if (visible.current >= 1000)
                emit('ad_impression');
            if (visible.current >= 2000)
                emit('ad_qualified_view');
            if (ad.mediaKind === 'photo' && visible.current >= 5000) {
                emit('ad_complete');
                leave();
            }
        }, 100);
        return () => clearInterval(timer);
    }, [ready, active, paused, menu, ad.deliveryId, accessToken]);
    const gesture = useMemo(() => {
        let startY = 0;
        let hold: ReturnType<typeof setTimeout> | null = null;
        let held = false;
        const clear = () => { if (hold)
            clearTimeout(hold); hold = null; };
        const responder = PanResponder.create({ onStartShouldSetPanResponder: () => true, onPanResponderGrant: e => { startY = e.nativeEvent.pageY; held = false; hold = setTimeout(() => { held = true; setPaused(true); }, 250); }, onPanResponderRelease: e => { clear(); setPaused(false); const dy = e.nativeEvent.pageY - startY; if (Math.abs(dy) > 100) {
                leave(dy > 0);
                return;
            } if (!held)
                leave(); }, onPanResponderTerminate: () => { clear(); setPaused(false); } });
        return { ...responder, clear };
    }, [ad.deliveryId]);
    useEffect(() => () => gesture.clear(), [gesture]);
    useEffect(() => { if (!active) {
        gesture.clear();
        setPaused(false);
    } }, [active, gesture]);
    const hide = () => { setMenu(false); emit('ad_hide'); callbacks.current.onHide(ad.creativeId); leave(); };
    const report = (reason: string) => { setMenu(false); if (accessToken)
        void reportAd(ad.deliveryId, reason, accessToken).catch(() => Alert.alert('Report failed', 'Please try again when connected.')); leave(); };
    const more = () => setMenu('options');
    const source = { uri: `${API_BASE_URL}/api/v1/ads/deliveries/${ad.deliveryId}/media`, headers: { Authorization: `Bearer ${accessToken}` } };
    const open = () => {
        const action = adCtaAction(ad);
        if (!action || (action.kind === 'profile' && !onOpenProfile))
            return;
        emit('ad_click');
        if (action.kind === 'profile')
            onOpenProfile?.(action.username);
        else
            void Linking.openURL(action.url).catch(() => Alert.alert('Unable to open link'));
    };
    const choices = menu === 'report' ? [['Misleading or scam', 'scam'], ['Inappropriate', 'inappropriate'], ['Offensive', 'offensive'], ['Prohibited product or service', 'prohibited'], ['Impersonation', 'impersonation'], ['Other', 'other']] : [];
    return <View style={styles.root}>
  <Modal visible={!!menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
   <View style={styles.modalBackdrop}><ScrollView style={styles.modalPanel} contentContainerStyle={styles.modalContent}>
    <Text style={styles.brand}>{menu === 'report' ? 'Report Ad' : 'Sponsored Story'}</Text>
    {menu === 'report' ? choices.map(([label, reason]) => <Pressable key={reason} accessibilityRole="button" onPress={() => report(reason)}><Text style={styles.menuOption}>{label}</Text></Pressable>) : <>
     <Pressable accessibilityRole="button" onPress={hide}><Text style={styles.menuOption}>Hide Ad</Text></Pressable>
     {ad.reportingEnabled && <Pressable accessibilityRole="button" onPress={() => setMenu('report')}><Text style={styles.menuOption}>Report Ad</Text></Pressable>}
     <Pressable accessibilityRole="button" onPress={() => { setMenu(false); Alert.alert('Why this ad?', ad.explanation); }}><Text style={styles.menuOption}>Why am I seeing this?</Text></Pressable>
    </>}
    <Pressable accessibilityRole="button" onPress={() => setMenu(false)}><Text style={styles.menuOption}>Cancel</Text></Pressable>
   </ScrollView></View>
  </Modal>
  {valid && (ad.mediaKind === 'video' ? <Video source={source} style={StyleSheet.absoluteFill} resizeMode="cover" paused={!active || paused || !!menu} onReadyForDisplay={() => setReady(true)} onError={fail} onEnd={() => { if (active) {
        emit('ad_complete');
        leave();
    } }}/> : <Image source={source} style={StyleSheet.absoluteFill} resizeMode="cover" onLoad={() => setReady(true)} onError={fail}/>)}
  <View style={StyleSheet.absoluteFill} {...gesture.panHandlers} accessible accessibilityRole="button" accessibilityLabel="Sponsored Story. Swipe up to skip or down to go back." accessibilityActions={[{ name: 'next', label: 'Next creator' }, { name: 'previous', label: 'Previous creator' }]} onAccessibilityAction={e => leave(e.nativeEvent.actionName === 'previous')}/>
  <View style={styles.header}><View><Text style={styles.brand}>{ad.brand}</Text><Text style={styles.disclosure}>Sponsored</Text></View><Pressable onPress={more} accessibilityLabel="Ad options" hitSlop={12}><Icon name="more"/></Pressable></View>
  <View style={styles.footer}><Text style={styles.caption}>{ad.caption}</Text><Pressable style={styles.cta} onPress={open} accessibilityRole="link"><Text style={styles.ctaText}>{ad.cta}</Text></Pressable><Pressable onPress={() => leave()} accessibilityRole="button"><Text style={styles.skip}>Skip ad</Text></Pressable></View>
 </View>;
}
const styles = StyleSheet.create({ modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 24 }, modalPanel: { flexGrow: 0, maxHeight: '80%', backgroundColor: '#222', borderRadius: 16 }, modalContent: { padding: 20 }, menuOption: { color: '#fff', fontSize: 16, paddingVertical: 16 }, root: { flex: 1, backgroundColor: '#111' }, header: { position: 'absolute', top: 30, left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between', padding: 12, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8 }, brand: { color: '#fff', fontSize: 18, fontWeight: '700' }, disclosure: { color: '#f4c24f', fontSize: 14, fontWeight: '700', marginTop: 4 }, footer: { position: 'absolute', bottom: 30, left: 20, right: 20 }, caption: { color: '#fff', backgroundColor: 'rgba(0,0,0,0.6)', padding: 8, marginBottom: 12 }, cta: { backgroundColor: '#f4c24f', borderRadius: 10, padding: 16, alignItems: 'center' }, ctaText: { color: '#111', fontWeight: '700' }, skip: { textAlign: 'center', color: '#fff', padding: 12 } });
