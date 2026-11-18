# Amiga Exolon mechanics research, original Disk.1

All addresses below are original 68000 RAM addresses. No ZX logic or tables used.
Exact extracted arrays and all125 screen metadata are in logic-tables.json; extraction is logic-extract.py. The product copies these as AMIGA_NATIVE in constants/index.ts.

## Loop and coordinate contracts

Main loop $869c..$873a performs one update then calls $873e once. $873e calls $e034, selecting the display buffer, zeroing and waiting on the VBL flag word $e064. This synchronizes to the next PAL VBL after CPU work, not necessarily the immediately following VBL. The earlier inference of50 simulation updates/second was incorrect. Core-cycle measurement of the source first-screen loop takes339194..351128 cycles before waiting, exceeding two PAL frame budgets on a7.09MHz68000. Browser gameplay uses50/3 updates/second as a stable baseline; menu PAL time stays50Hz. DMA/IRQ contention and scene-dependent slowdowns are not emulated. Reproduction and limits: [amiga-timing.md](amiga-timing.md).

Native player X/Y are words $f9e2/$f9e4. X is pixels; Y is the40-pixel body bottom. Render origin is(X,Y-40). Pose $f9ea is0..14 right,15..29 left. Pose0/15 idle,1..12/16..27 walking,13/28 jumping,14/29 ducking. Hero graphics32x40. Armor $f974 selects the other30-frame set.

Native map lookup $c642: RAM$121c + screenOffset($fbb0) + floor((Y-39)/8)*40 + floor(X/8). Row width40, map23 rows, screen stride$398=920. Solid tile IDs$78..$a6 inclusive. $e8d6 checks five head bytes; $e9bc checks five feet bytes at+200; $e9f0 checks four feet at+201 (left-facing), $ea24 checks four feet+200 (right-facing; only two atfar-right).

Production model preserves playerY and normalizes entities to display-pixel origins. sourceY offsets in ROM routines differ by entitykind, so do not apply a common-40 to entities in the renderer.

## Native player and weapons

Input byte$fbc6: bit0up/jump,1down/duck,2left,3right,7fire, decoded by$e2f6.

$e376..$ee50 is player control. It runs after enemy/projectile steps and collisions. A direction change consumes one ground tick without movement. Continuing ground movement is3 pixels/update, maxX310, minX3; no backward screen transition. Gravity is4 pixels/update; grounded Y is aligned down to8. Ducking shifts anchorY+6 and usespose14/29; unducking subtracts6. Ground duck blocks walking/jumping. Jump starts by selecting table, firstdelta applied nexttick. Vertical15 signed deltas at$f896:
[-4,-4,-4,-3,-3,-2,-1,0,1,2,3,3,4,4,4], then sentinel255.
Directional15(dx,dy) pairs at$f8b6(left)/$f8f4(right); seeJSON. Horizontal sum±62, verticalsum0; firstdx/dy±5,-5 and last±5,+5, intermediate|dx|4. Collision cancels or modifies arc. Production follows source directional side samples at mapIndex+119 (left) /+164 (right): solid side retains arc entry and applies onlydy; right additionallypushesX-4. Body/object obstruction cancels jump; rightscreenboundary check happensbefore applyingdx. Sourcefixturetests coverthesequirks.

$e916 checks six tiles in maprow immediately above hero forID$78 onup. It toggles armor, copies/mirrors armor sprites. $d488 teleport checks onup: pads derive fromtile$7b, storedX=markerX+8. Hero test rectangle [X+12,Y ..X+20,Y+18] in source coordinates againstpad[X-9,Y+56 ..X+2,Y+88]; then destinationhero=(otherX-20,otherY+56).

$e384 fire firstedge emits one bullet; heldfire increments$f972 and at10 further ticks attempts grenade, resettingholdcounter0. Holding never auto-repeats bullets; release resetsedgeflag$f973. Bullet lifetime15 updates, speed12px/update, eight slots. Normal bulletspawn=(playerX+22,playerY+12), left subtract30X; normalizeY-40. Armor addssecondbullet(playerX+23,playerY+19), againleftsubtract30; oneammocost. Original occupancy guard checks existinglife>17, which cannot arise fromnormal15 initiallife.

Grenade oneactive atonce, consumesone; initial=(X+2,Y+5), left adds16X. Native pairarc$f9fa39pairs, sentinel500, parsedJSON. First(3,-4), then(4,-5),(4,-5), speedslater9/10 anddownfall7. Left subtractsdx, rightadds. Map samples atgrenade(X+6,Y-40) andsixlower BEFORE applyingarc. Production nowchecks beforearc, coveredbyasourcefixture. Rectangles ofbullets/grenades are normalized and sometimes broader thanexactsourcecorners.

## Death, campaign and points

$ab78 ignoresdeaths until$fbea>25; reset$fbea=0 andincrementeachloop =>26 protectedticks. Death storesoldposition$fbe0, immediatelymoveshero toscreenentrycheckpoint$f9e6, clearsjump, decrementslives unlesscheatword$fbde=0, restoresbullets99 andgrenades10. Deathanimation15frames of48x48 at$42e8c orarmoredsetat$4720c; controls/hero drawing resume onframe15. Initialgame $9690: bullets99,grenades9,lives9. Cheat originally activated byhighscore name'ad astra'. Currentbrowseroptions do not require thathistoricalentry.

Native endscreen table$92a2=[24,49,74,99,124]. AtX>=190 $922a entersstagebonus. $8d1a givesbravery10000 ifunarmored,0 ifarmored; lives*1000. Native requiresfireonce tocontinue thenfireagain tostoproulette. $fcbd pointerrows90..146 step8, eightrewards0,1000,0,3000,0,5000,0,7000; table$fbec contains0,20,0,60,0,100,0,140 units*50. Production has bonusPhase summarythenroulette withrelease/fire edges. Enteringsummaryqueuesbravery/lives; stoppingroulettequeuesselectedreward. Atend124 production bonusPhase follows summary->ending->roulette with separate releasedfireedges. Stopping finalroulette immediatelyrestoresstage0,statusplaying, emitseventwon+screen0, preserves score/lives/pendingScore andresetsammo99/grenades9/Y176/armorfalse. Congratulations appearsbeforefinalroulette asoriginal.

$c91e incrementsglobalindex1 andscreenOffset920; per25 stageend loadsnextmapbank andresetslocaloffset0. New screenX3, preservescurrentY; checkpoint capturesentryX/Y. Mapsfivebanks125total, globalmetadataall125 in RAM$112d0 onward.

Score storedlong$103f0. $9108 scorequeue$fbdc increments50 perupdate. Mostflyer/destructible kills150, podparticles50, shootdownenemybullets50. Bonusplatform$type3 native queues40 =>2000 once/screen. Vertical20-hitlaserqueues20 =>1000 onEVERY bulletimpact, noadditionaldestructionbonus.

## Object metadata and source-derived logic

All metadata recordsindexedglobal screen, notlocalstage:
$112d0:125x8 two pickup(x,y) pairs;501 meansabsent. Type0 refillbullets99, type1grenades10. Graphics$17c24/$17ca4 16x16.
$116b8:125x4 podinitialstates;0sealed,1released. Markers$f5/$f6. Nativebody64x64. Teninitialparticlesat$f186 exactpairsJSON, 8x8hitboxes. Sealedparticlesconfinedx15..32,y10..19relativetopod; releasedx10..300,y=podY..podY+45. Randomperstep:0..5up4;6..17down4;18..140right4;141..254left4. State1 harms/shootable, state2dead. Grenade150 killbodyandreleaseallten. Bulletsstopatsealedbody. Bodyrender$2b26c, particle raw$16210 frame0 (16x8; generatedshiftatlas$249ec).
$118ac:125x8 flyer(graphicsPointer,pathPointer). Fourreloadedgfxvariants$1a790,$1b090,$1b990,$1c290. Sixframes32x24. Five paths$f202,$f254,$f362,$f4f8,$f622 of20,67,101,74,99 signed(dx,dy) pairs, loopat500. $a042 spawnsatrawX368=>displayX320, rawY=playerY+60-random0..7 =>displayY=playerY-40-random. AllowsnewspawnifplayerX<=220, noexistingrawX>280=>displayX232, random<=80, max5slots. Updatepaththenframe modulo6. Hurtboxdisplay[x+8,y ..x+32,y+22], playertop+4.
$11c94:125x3 spikecolumns in16pxunits, terminator100. Random<7 initiates48px extension/retraction at8px/update. $a3a6 graphicY175-height (up to49 blitrows withnativeinclusiveDBRA); $b1e4 damageY184-height..184,9px lower thanbitmap! Armorprotects. Model storesgraphicY andadds9 forhurlbox.
$11e0b:125flags backgroundreplacementgraphics ondestruction.
$11e88:125x4 turrettypes. Markers$fc/$f8. Types0/1/2 mapnativestates1/2/3; rawbases$2e47064x64,$2f07064x32,$2ec7064x32. Type2 is BOTH the low double-projectile gun and a bonus platform. $b8b4 moves shots left12 each tick regardless of the current turret being alive. Upper types0/1 use probabilityrandom<11 and a four-frame recoil cooldown, with source muzzle(x,y)=(turretX,turretY+23/+6) respectively. Low type2 usesrandom<14 only ifplayerX<=turretX-50; muzzle=(turretX-4,turretY+4), adding8 toY when its second random value<=120. It uses the second projectile graphic via native pool$111a2 and retains phase8 without recoil. Bullets have10x6 hitboxes. Grenades destroytypes0/1, ordinary bullets are blocked; type2 also allows its once-per-screen bonus.
$1207c:125x5 barriertypes. Markers$ff/$f7. Gfx64x64 at$2926c+type*$800, 4types. Allsolidtoside/jumpbody andordinarybullets; grenade150 destroys.
$122ee:125x32 up toeightstaticdecorationpointers fortile$fe.

Tile$7b teleporter marker; tile$a2 mine. Mineunderfootchangesmaptile$a3, sparksanddeathunlessarmored; fivepersistentblinkslots. Tile$f9 vertical20-hitlaser, source$D184: X=(col+1)*8, fullheightwall, bullethealth20; killheroifX+32reacheswall; grenadesdisappearwithoutdamage. Type0tile$fb launcher: animationX=(col+1)*8, Y=markerY-32. Important68000predecrement: $d340 longpostincrement +=4, $d346 wordpredecrement -=2 modifiesY, notX. Staticlauncher32x48 drawsoriginalmarkerY, animation4frames32x32 aboveit. One homing rocket starts atX320,randomY0..175 with initial left speed5. $a580 applies its stored speed, then $a5d8 selects4/6/7 for the next update using the new X>=150/>=110/else. Y changes by2 toward the band(playerY-40,playerY-30]. Rocket16x10damagebox, graphics32x15. Direct bullets and grenades do not damage this rocket. Only grenades are checked against its launcher ($afc6..$b078), awarding150 points; ordinary bullets pass the launcher. Once destroyed, $a806 returns before $a50e, so guided movement/drawing/collision stop. Browser destruction removes the associated active guided rocket while retaining the original static lower base.

$881a increments screen counter$f976 on every gameplay update. At exactly300 ($12c) it initializes the tracking hunter atX320, sourceY=playerY (displayY=playerY-40); movement and collision begin on update301, five pixels left per update. This is time spent on one screen, not a stationary-player detector: walking, firing and ducking do not reset it. Native screen advance$c92e and death$ab86 clear the counter. It repeats a crossing after going off the left edge. Graphics$17d6a 32x21, collision20x40. Productionmodelrepresentsbothhomingrocket andtrackinghazard askind'hunter',type1/type0. At the browser's60ms gameplay step, initialization is18.00s after screen entry. An isolated level-ground model trace with heroX3 records no hunter at tick299, X320 at300, X315 at301, and collision/death at357 (21.42s). Time to impact depends on hero position, height and movement; this is not a universal death deadline. Pausing freezes model updates. Original hardware seconds depend on its scene-dependent CPU/DMA pacing; the source threshold is300 iterations, not a fixed18-second wall-clock timer.

## Random recurrence and boundaries of port

$ef06 modifieslowbyteL=((L&0xffffff00)|(L&14)|32), then64-bit(H:L)*$20003 modulo2^64. $ef4a returns(H>>>16)%255; $bae4 same. Productimplementswith32-bitcarry arithmetic (noBigInt), explicitseed/seedHigh. Hardwareinitialseedandcosmetic RNGcalls differ; noexactgameplaytraceequivalence claim.

Nativecollision$e164 iscornercontainment, notgeneralrectangleintersection. Production nowexports nativeAmigaOverlap as theliteral8-corner test: first4AcornersinB useXinclusive/Ybottomexclusive; thenBbottomright,bottomleft,toprightinA withsamebounds; finalBtopLeftallowsY<=Abottom. Crossingrectangleswithnocornerscontainedreturnfalse. Testscovercrossingfalse andlastcornerasymmetry. Particlecosmetics/destructiondebris, cosmetic RNGcallcount, exact per-entity update/collision ordering, stilldifferasnoted. Thesearependingfidelitywork, notverifiedfeatures.

## Exact menu text positions

Textrecords$87ba usefirstbyteX/8,secondbyteY,ASCII, negativebyte startsnextrecord,0end.
$fc02 loading... at120,90.
$fc0f credits:80,70 program by m.j. bysh;64,85 amiga version by g. henkel;80,100 graphics by g.p. felix;96,115 music j.d. rogers;96,130 sound by g. henkel;88,178 press fire to start;40,190 exolon copyright1989 by hewson.
$fcbd bonusheading96,70; stopinstruction56,80; rewardlines112,Y90,98,106,114,122,130,138,146. Pointer208,Y90..146.
$fd70 bravery96,88; reward96,96; lives96,104; multiplier96,112; continue96,120 and96,128.
$fe0a highscoreentry:88,72 congratulations;64,88 please enter your name;48,104 into the exolon hall of fame;120,128 ten-charactername.
$fe61 final:104,80 congratulations;80,96 you have proven your;104,104 combat abilities;120,112 to the full.;120,144 press fire;104,152 to resume play.
$feca gameover112,88 and112,96.

## Reproducible model extraction

Offlinecommand: node tools/recovery/amiga-model.mjs /path/to/Disk.1 /tmp/amiga-model-constants.ts (optionaloutputpath; otherwisewritesTypeScriptsourcetostdout). Outputusesexclusivecreation. Strict extractAmigaModel(memory) verifies512KiBRAM SHA256 8eb436440c0f6af0381079341779e24dcbd21d485144f2dcacb059a7e9c724e7. readAmigaModelTables providesseparateboundedfixturedecoderforindependentlyconstructedminimalRAM; productionCLIalwaysusesverifiedextractor. OriginalDisk recoveryisimportedfromexistingamiga.mjsunchanged. ActualofflinerunfromverifiedDisk.1 deep-comparedALLmodeltableswithAMIGA_NATIVE, then CLI-generatedconstantcomparedbyte-for-bytewithcommitted48345-byteconstant. SourceconstantSHA256 bde8c7c9d90bcde0065ad481fb604fb0c47d3d1658c1b5013b4478c23cbca6e9; JSON.stringify(AMIGA_NATIVE)goldenSHA256 8df2171fa78420cccfbd6bd8b03f376d6e2a4c282e351837829fdab126fb92f3. Includes125screens,5trajectories, alljump/grenade/pod/turret/bonusarrays. Ordinarybuilddoesnotimport/runextractor.

The source-constant byte/hash above records the initial extraction. On20.11.2026 the authored timing exports were corrected to separate PAL refresh50Hz from gameplay50/3Hz; AMIGA_NATIVE and its canonical JSON hash remain unchanged. The extractor emits the updated exports too.

## Teleport effect lifecycle and position — 20.11.2026

Original byte $f0b4 starts at13. $d3da returns immediately at13; otherwise it draws the current frame for both pads and increments the byte. These are thirteen one-shot effect frames, not a continuously looping idle animation. Successful transport $d5ae resets the byte to0 only when it is at least7; $d498 blocks transport during phases0..3. Drawing happens before player control, so a newly triggered frame0 appears on the following update. The browser model stores the pending phase and the frame actually drawn by that update separately; rendering alone never advances the effect.

$d40c subtracts16 from stored padX and adds16 to padY; $be54 aligns X down to a16-pixel boundary. Hence display origin is((padX-16)&~15, padY+16), with a transparent32x32 blit from $1dd6c+frame*512. The earlier renderer incorrectly used globalTick%13 at(padX,padY), making an unused chamber flash continuously with energy outside its opening. Source-derived model, pixel-composition and browser regressions cover the idle chamber and one complete activation.

## Launcher upper sprite alignment — 20.11.2026

For marker $fb, $d32e stores logical X=(column+1)*8 and $d346 changes only the stored Y to markerY-32. Static base $d362 and upper animation $a854 independently apply ANDI.W #$fff0 before converting X to a bitplane byte address. Both therefore draw at logicalX&~15. The earlier renderer used the unrounded logical X for the upper sprite, shifting it8 pixels right on even map columns; odd columns were already aligned. Only presentation rounding was changed, preserving native logical/hitbox coordinates. Pixel regression covers both column parities and all four original upper frames. The lower32x48 base remains after the upper launcher is destroyed, as in the source.

## Low double turret source fixture — 20.11.2026

The previous engine skipped firing for type2 because it awards the2000-point bonus at$906c. Original$b918..$ba68 handles state3/type2 through$b972 in addition to that bonus; it does not treat this installation as inert. Branch$b9f0 handles the other two types. The renderer already has both original projectile graphics; the low branch must choose type1 rather than the default type0. These are the original compound projectile sprites/pools, not newly invented independent shots.

An offline machine68k0.5.2 M68000 probe executed original$b8b4 with one turret at(240,24), phase8, RNG words0/0 and empty10-slot projectile pools. Only drawing$d850/$bd4e was replaced withRTS; original firing decisions and RNG were retained. With native state3 and heroX3 it emitted pool$111a2=(236,36), kept phase8 and left pool$11178 empty. Native states1/2 with heroX240 emitted pool$11178=(240,47)/(240,30), reset phase0 and left pool$111a2 empty. Model regressions assert these source outputs, the low-gun distance gate and continued bonus; a browser regression verifies the actual screen4 installation fires.

## Hall of Fame scrolling geometry — 21.11.2026

Native$8b68 places the176x40 logo at framebuffer offset$14a, hence X80/Y8. The title uses a different originY18. Source table records at$fee8 carry coordinates$0c,$c0: textX96, insertionY192. $8c62 inserts a record every eight scroll updates. The visible copy at$8cbe starts offset$87a (54*40+10), spans ten words per scanline (160pixels, X80..239) and DBRA$89 copies138lines (Y54..191). The font is eight scanlines high and the row pitch is8. Text must be clipped scanline-by-scanline at both edges; skipping entire rows causes popping and incorrect placement. The initial eight empty steps give first-row topY=200-scrollStep.

The previous renderer used X72, twelve-pixel row pitch, whole-row limitsY>60/Y<190, and the title logoY18. These were corrected only for Hall of Fame. Existing browser scroll-pixel timing (80ms) and loop/re-entry behavior are retained; frame-geometry matching does not claim measured original wall-clock animation speed.

[amiga-score-scroll.json](amiga-score-scroll.json) contains independently generated native pixel/RGBA hashes for eleven source frames and the logo. The offline probe executes unchanged original$8ab4,$8b62,$8c62 on machine68k0.5.2 after checking the recovered-RAM hash; only framebuffer addresses are relocated to scratch RAM. It includes original font rendering and memory copies. Reproduce with the same temporary environment as the timing probe: `python tools/recovery/amiga-scores.py /tmp/amiga-ram.bin`. Unit tests compare full renderer output, and native/legacy browser tests compare entering, complete and top-clipped text frames.

## Guided rocket weapon and movement fixtures — 21.11.2026

Offline execution of original$ad30 with a bullet at native(100,180), guided rocket at(100,140) and launcher at(100,140) left all three unchanged. With an overlapping grenade, the launcher X became501 while rocket memory remained100; future$a806 then returns without invoking rocket logic. No direct guided-rocket weapon target exists in this source branch. The browser previously put all hunter entities in a shared shootable-target branch and left child rockets active after launcher destruction; that was corrected for type1 guided rockets.

Executing$a50e with playerY176 and rocketY135, with drawing$a648 bypassed, produced (X,Y,nextSpeed): (320,5)->(315,137,4), (150,4)->(146,137,6), (110,6)->(104,137,7). These fixtures preserve the initial five-pixel step and acceleration selection after movement. The earlier browser applied the newly selected speed immediately, moving one pixel too little at launch.

## Screen9 upper-floor wall — 21.11.2026

The original first-stage disk map at$51e00+28+8*920 has solid tile$94 at column29 (X232..239), rows0..10. It closes the right end of the upper corridor. Original$e866 calls$c642 and samples +$a4; for heroX201/Y56 this reaches row6/column29, so$e882 returns without moving. Independent execution of unchanged$e376, with the original disk map and no irrelevant dynamic objects in the upper corridor, gave X positions183,186,189,192,195,198,201,201,201,201,201,201. The browser model gives the same positions. This is original terrain, not an invisible browser collision or a destructible entity.

The upper teleport stores(200,0); using Up with hero(180,56) returns to the lower pad with hero(36,176). On the lower floor the barrier at(176,112) can be destroyed by a grenade. An invulnerable model route verified this separately from hazard survival: throwing from(132,176) destroyed it after19updates for150points, then walking right entered screen10 at(3,176). The intended route does not require passing through or destroying the upper wall. No gameplay change was made.

## Zone 10 standing rocket rack — 21.11.2026

The first-stage tenth map (zero-based screen9) contains a static barrier at(96,112), variant1, selected by `$cd4e` from `$1207c + 9*5`. It is not the `$fb` guided-rocket launcher. Offline execution of original `$cd4e` and `$d2fc` on that unmodified map produced barrier(96,112), type1 and guided-launcher X501 (inactive). Only barrier blitting `$ce84` was bypassed during classification; map scanning and selectors ran unchanged.

Original grenade collision `$c038 → $e0f0` with native grenade(96,176) changed the barrier X to501, added150 points and cleared grenade-active. Debris drawing `$bedc` and background replacement `$cbb4` were bypassed for that probe. The browser model agrees: an overlapping bullet leaves the barrier with score0, a grenade removes it and gives150, and299 neutral updates emit no enemy shots or guided rockets on this screen. Standing missiles here are a destructible obstruction; their lack of firing is expected. No game logic was changed.

## Title stars and Hall of Fame pipes — 21.11.2026

Native title `$95e6..$9652` draws the credits/logo and invokes `$96f0` every four PAL refreshes. Ten slots at `$f7e6` use seven16x16 frames from `$1a790`; phase7 erases a star and frees its slot. `$96f0` allocates one free slot per update, choosing16px grid positions outside the central credits/logo, then advances all active slots. Stars are animated sprites, distinct from the procedural one-pixel gameplay field. Browser presentation follows this lifecycle at80ms/update with fixed seeds `$19871201/$12345678`; native `$ef4a` uses divisor`$ffff`, independent of the existing gameplay RNG range adaptation.

Hall of Fame `$8b62 → $8b98` draws the original64x64 block from `$28a6c` at X0/X256 and Y0/64/128, framing the scrolling list with vertical pipes. Earlier checks covered the logo and central text only, missing these outside margins. Extraction now preserves `menu-stars` and `score-pipe`, with provenance for their original bytes and drawing code. The offline score probe now compares full320x200 frames: eleven rating frames and thirteen title-animation frames produced by unchanged original routines. Renderer tests also check re-entry, skipped/repeated RAFs; browsers compare full frames in native and legacy bundles.

## Gameplay sparkle — 21.11.2026

The gameplay loop calls `$c18e` once after player/foreground drawing. This is separate from both `$c29c` static one-pixel stars and `$96f0` menu flares. A single active8x7 sparkle uses frames1..8 from `$17ece` (28 bytes/frame, four byte-interleaved planes per row); the following update clears its active flag. While inactive, `$c31a` chooses a byte below176 and only values below65 start an effect. A second sample chooses Y0..175; `$c2f6` chooses X0..319, aligned down to16 pixels. The saved background planes mask the sparkle: only completely black scene pixels receive its source pixels. Its maximum bottom row is181, outside the HUD.

The browser now advances that lifecycle from model ticks, so paused/repeated RAFs cannot animate it. A renderer-owned cache avoids replaying earlier ticks on every frame; reset/rewind/screen changes restart a separate deterministic cosmetic seed. This preserves original visual rules, not the hardware/global-RNG sequence or its cross-screen carryover. Gameplay RNG and timing remain unchanged. `tools/recovery/amiga-stars.py` executes unchanged `$c18e` and its RNG helpers on the verified RAM with a fixed seed and the existing browser static star field. [amiga-game-stars.json](amiga-game-stars.json) holds65 ordinary and65 occupied-mask reference frames. Unit tests verify full playfields, masking, HUD exclusion, cached/skipped/repeated ticks and screen resets; browser native/legacy fixtures isolate actors while exercising the real compositor/clock and pause.

## Heavy rocket sprites and structural fragments — 21.11.2026

The heavy projectile was using source projectile frames9/10, which belong to other effects. Original `$c170/$c17a` selects shift-atlases `$2066c/$20dec`, built at `$84b0/$84c8` from `$16060/$16090`: frames2/3. The renderer now uses that right/left rocket pair. Its native `$f9fa` rising/accelerating/falling path, hold threshold and ammunition rules are preserved. The forward-edge check was corrected to match `$c0ca/$c11c`: rightward rockets test only X>=304, leftward ones only X<=8. The old shared check incorrectly removed new inward-moving shots at the entry edge. Internal `grenade` identifiers remain compatible with existing saves/events; they do not select an invented round grenade sprite.

Original structural destruction calls `$bedc`, filling a210-slot pool from reusable startup-generated offset tables. Directions start47..0 and then repeat15..0; `$bf3c` adds fixed vectors from `$11060`, retiring fragments outside X8..304 and normalized Y10..170. The native shard is a two-plane32x9 shifted atlas at `$285ec`; `$d5d4` maps its two inks through palette pairs(1,2),(2,4),(4,8),(8,2). The browser extracts the unshifted source art and uses normal pixel blitting for arbitrary X. Fragments render after the foreground pass, as `$bf3c` follows `$c824`. They are cosmetic and do not cause damage or award extra points.

The restored bursts use the original profiles: barriers and sealed pods125 wide-table fragments; upper turret type0 and guided-launcher100 compact-table fragments; upper turret type1 uses125 wide-table fragments; the vertical laser uses125 vertical-table fragments. Color selectors preserve the source caller values (including40/50/160 mapping to the fourth palette pair). Structural hits emit the existing destruction event and fragments instead of a substitute large fireball. Pod particles and guided-flight cancellation retain their previous rules.

`tools/recovery/amiga-projectiles.py` verifies source RAM and executes unchanged original startup-offset generation, sprite-atlas builders/blitters, `$bedc` and `$bf3c`. [amiga-projectiles.json](amiga-projectiles.json) preserves source sprite hashes, seeded offsets, all48 velocities and six burst traces across32 updates. Fragment offset constants use a fixed startup seed instead of hardware clocks; they do not consume or alter gameplay RNG. Probe burst origins are normalized(96,64), isolating pool/motion rules from caller-specific collision coordinates. Reproduce with the temporary machine68k environment: `python tools/recovery/amiga-projectiles.py /tmp/amiga-ram.bin --constants src/games/amiga/constants/debris.ts`. Unit checks compare both rocket directions, all four shard palettes, all six model burst traces, immutability and pool limits.

## Blue Game Over window — 21.11.2026

Original `$88f0/$88fe` displays Game Over over the gameplay framebuffer without switching to the menu palette. `$8ed8` with D0=6,D1=72,D2=6,D3=2 builds an opaque128x48 window at(96,72): corners from`$179e4` (window-tile3), horizontal borders`$17ae4` (tile5), vertical borders`$17a64` (tile4). Both padded text rows at(112,88)/(112,96) fill its black96x16 interior. Tiles are copied opaquely, including their black pixels; transparent blitting would incorrectly retain background inside the border.

The earlier renderer replaced the entire stage with a black menu/logo screen. It now retains the composed scene and stage palette and draws the native blue window. Existing Continue/name-entry/score flow remains unchanged. The offline score probe executes unchanged `$88fe..$8932` before the delay, verifies the complete window is opaque over different backgrounds, and records RGBA hashes for all five stage palettes in [amiga-score-scroll.json](amiga-score-scroll.json). Unit tests compare that window in every world and preserve all pixels outside it. Browser native/legacy scenarios reach Game Over through real life depletion on an isolated pit map and compare the original dialog pixels.


## Retracting floor pistons — 21.11.2026

The piston logic (`spike` internally) was present on21 original screens, but its extracted sprite was blank. The startup RAM snapshot precedes a late `$8660..$867e` disk request:768 bytes from disk `$37000` to RAM `$18102`. Extraction now reads those original bytes directly and records their provenance without changing the verified startup snapshot. The32x48 four-plane sprite has one additional cleared16-byte row because the native DBRA copy draws height+1 rows, including49 at full extension.

Original `$a3a6` draws the previous height opaquely at(column*16,175-height), then advances its state. An idle low random byte below7 arms it without growing that update; it then rises by8 to48 and retracts by8 to0. The browser preserves this draw/state distinction and uses the original65535 random modulus for this procedure. Collision checks precede this update; armor protects against pistons. Foreground redrawing hides the lower part beneath the floor.

`tools/recovery/amiga-pistons.py` executes the unchanged original late-load and piston procedures on verified Disk.1/startup RAM, replacing disk I/O only with the requested byte copy. [amiga-pistons.json](amiga-pistons.json) records the request, sprite hash, opaque rendering at all seven heights and a16-update state trace. Unit tests compare these independent source references, including black-pixel erasure and floor clipping. Browser scenarios exercise a full original-screen extension and pause in native/legacy builds.


## Mine activation particles — 21.11.2026

Original `$ead8..$eb58` increments the stepped tile`$a2` to`$a3`, registers its persistent blink, and calls `$bedc` with D1=`$50` (DBRA:81 particles), D4=1 and compact offset table`$10cc0`. The burst origin is playerX+12, playerY+35 in native coordinates, normalized to(playerX+12,playerY-5). Palette selector1 uses the original orange/red/gray two-plane shard. The same48-direction pool and fixed vectors disperse it to the sides/upward; offscreen pieces retire normally. The old JS branch incorrectly substituted one large explosion sprite. Activation now spawns the original pool profile before the existing unarmored death check, retains the explosion event and the already implemented spent-mine blink, and does not repeat on a spent tile.

`tools/recovery/amiga-projectiles.py` now also executes unchanged `$ead8` after its tile scan, with armor enabled to return before death control, followed by32 unchanged `$bf3c` updates. [amiga-projectiles.json](amiga-projectiles.json) records that mine's tile mutation and81-particle trace. Model tests trigger a real mine with and without armor and compare every recorded burst frame, life loss/protection and one-shot behavior. Native/legacy browser scenarios step onto an isolated mine and verify visible original orange particles above the floor.


## Small impacts — 21.11.2026

The JS projectile branches incorrectly reused the enemy large-explosion resource for blocked shots. Original `$b4a2/$b54c` (intact turrets/pods), `$b0ce` (laser wall) and `$9ea0` (solid scenery) enqueue `$a970`. `$a926` advances this pool through frames1..8, retiring on the next tick. `$aad6` draws32x8 from `$16450`, aligning X down to16 pixels. The separate `$aa96/$aa3a` pool and `$185d0` resource are used for a large enemy explosion. This fix selects the already extracted small impact for existing blocked-projectile branches and laser-wall bullet hits, retaining enemy explosions and structural debris.

`tools/recovery/amiga-impacts.py` executes unchanged `$a970/$a926/$aad6` on verified recovered RAM; only the framebuffer pointer is relocated. Reproduce using the temporary machine68k environment: `python tools/recovery/amiga-impacts.py /tmp/amiga-ram.bin`. [amiga-impacts.json](amiga-impacts.json) records full320x184 indexed-frame hashes for all eight frames and retirement, including unaligned input X105. Unit tests compare the real compositor against these source frames, and model tests check the intact target, consumed shot, score, lifetime and enemy distinction. The browser fixture fires an actual bullet at a barrier in both native and legacy bundles.


## Player rocket smoke — 21.11.2026

Original `$e502` initializes the smoke budget to7. The active heavy rocket calls `$9886` before testing scenery or advancing its arc. This emits a stationary puff at the current rocket X-4 (right) or X+13 (left), unchanged Y, in the first free slot of a20-slot pool. Each puff starts with life6. `$98dc` draws, then decrements and frees the slot on zero. The source tables `$fb00/$fb18` select bullet-bank frames [7,6,7,8,9,10] to the right and [7,6,7,6,8,9] to the left. Smoke draws after the rocket in pool order and before the player/foreground. It has no collision or damage. Existing puffs finish their animation if the rocket disappears; changing screens clears entities as before. The JS model previously omitted this pool entirely.

`tools/recovery/amiga-rocket-trail.py` runs unchanged emission and drawing routines on hash-verified recovered RAM, rebuilding the original shifted atlases in scratch memory. [amiga-rocket-trail.json](amiga-rocket-trail.json) records positions/lifetimes and13 full-frame hashes per direction, including slot reuse and the final puff's retirement. The probe advances emitter coordinates using the original arc words, isolating smoke from collisions and background. Unit tests compare model pool traces and full compositor frames; the held-fire browser fixture now checks the real rocket with its first two puffs in native and legacy bundles. No new artwork or CPU execution is added to the browser.
