# JUST A MAN — Scene Image Prompts

Complete reference for generating all pixel art backgrounds, NPC scenes, activity scenes, event scenes, special scenes, UI screens, and item sprites for the game.

---

## STYLE GUIDE

### Format & Resolution
- **Dimensions**: 1280 x 720 pixels (16:9 aspect ratio)
- **Format**: PNG, no transparency on backgrounds
- **Style**: Pixel art, early 1990s LucasArts adventure game aesthetic (Monkey Island 2: LeChuck's Revenge, Day of the Tentacle, Indiana Jones and the Fate of Atlantis)
- **Technique**: Limited but expressive color palette per scene. Dithering for gradients and shading. No anti-aliasing on edges. Hard pixel boundaries. Hand-placed pixel feel.

### Style Prefix (prepend to ALL prompts)
> Pixel art, 16:9 aspect ratio, retro pixel art style reminiscent of early 1990s LucasArts adventure games. Limited but expressive color palette. Dithering for gradients. No anti-aliasing.

### Color Palettes by Mood

**Warm Morning** — Used for morning scenes, hopeful moments, early romance
- Golden amber (#D4A03C), soft peach (#E8B87A), dusty rose (#C4826E)
- Warm shadow: muted olive (#6B6340), soft brown (#5A4A2A)
- Accent: pale sky blue (#8CB4D0), warm white (#F0E4C8)

**Harsh Noon** — Used for midday scenes, high-energy moments, bustling locations
- Bright white (#F0F0E0), vivid blue sky (#4A90D0), hot yellow (#E8D040)
- Hard shadow: cool grey (#5A5A6A), slate blue (#3A4A5A)
- Accent: fire hydrant red (#D04030), taxi yellow (#E8C020)

**Moody Night** — Used for nighttime scenes, noir moments, tension, loneliness
- Deep navy (#0A0A2E), midnight blue (#1A1A3E), charcoal (#1A1A1A)
- Warm pools: amber streetlight (#D09030), tungsten (#C08840)
- Accent: cold TV blue (#6080C0), moonlight silver (#A0B0C0)

**Neon Nightlife** — Used for nightclub, casino, downtown night, celebrations
- Neon pink (#E040A0), electric blue (#4080E0), laser green (#40D060)
- Neon purple (#8040D0), hot magenta (#D02080)
- Base: deep black (#0A0A0A), dark purple (#2A0A3E)
- Accent: gold chain (#D0A020), champagne sparkle (#F0E880)

**Desaturated/Drained** — Used for game over, betrayal, breakup, defeat
- Washed grey (#8A8A8A), cold blue-grey (#6A7A8A), sickly green (#6A7A5A)
- Minimal warmth: single warm accent if any (Cherry Coke red, desk lamp amber)

### Character Rendering Notes

Characters appear at **40-50 pixels tall** when shown full-body in medium/wide shots. In close-up/medium shots, characters fill more of the frame.

- **Pixel construction**: Characters built with visible individual pixels. No smooth curves. Faces are ~8-12 pixels wide. Eyes are 1-2 pixel dots with highlight.
- **Animation-ready**: Characters should be rendered in poses that could be a single animation frame.
- **Expressions**: Conveyed through body posture, head tilt, and minimal pixel face features (eyebrow angle, mouth shape).
- **Clothing detail**: Conveyed through color blocks and minimal dithering. Patterns (plaid, stripes) rendered with pixel repetition.

### Recurring Characters

**The Man (MC)** — Young man, early 20s, dark hair (short/messy), sunglasses (often pushed up on head or worn). Early game: casual 90s attire (t-shirt, jeans, sneakers). Later game: better dressed (button-down, nicer jacket). Always recognizable by sunglasses and dark hair.

**Diana** — Early 20s woman. Creative messy hair (auburn/reddish). Headphones around neck (always). Band tee visible under denim jacket. Sketchbook often nearby. Expressive eyes. Cherry Coke is her drink.

**Vinnie** — 50s Italian-American man. Thick dark mustache going grey. Rumpled button-down shirt with rolled sleeves. Slightly overweight. Warm eyes despite gruff exterior. Always behind or near his counter.

**Marcus** — Early 30s man. Slicked-back dark hair. White dress shirt, suspenders, loosened tie. Pager clipped to belt. Sharp features. Confident posture. Wall Street energy.

**Ray** — Late 20s, wiry build. Leather jacket, dark jeans, boots. Aviator sunglasses (often pushed up). Toothpick in mouth. Street-smart body language. Guarded posture.

**Mrs. Chen** — 40s Asian woman. Structured blazer (navy), pearl earrings, elegant glasses. Perfect posture. Professional, composed. Warm but evaluating.

**Tony** — 40s, large/stocky build. Multiple gold chains over open silk shirt. Rings on fingers. Broad smile. Larger-than-life presence. Nightclub king energy.

---

## SCENE PROMPTS

---

### Category 1: Location Backgrounds (25 scenes)

---

#### Scene 001: `home_starter_morning.png`

**Image prompt**: Cramped run-down studio apartment, morning. Sunlight streaming through dirty window with bent venetian blinds. Mattress on floor with rumpled sheets, CRT TV on milk crate showing static, peeling wallpaper, bare lightbulb hanging from ceiling. Boombox on floor next to scattered cassette tapes. Mini-fridge with Cherry Coke can on top. Warm golden morning light, visible dust particles floating in sunbeam. Muted yellows, dirty whites, faded greens. Slightly elevated angle looking down into the room.

**Character note**: No characters visible. This is a location background.

**Mood/palette**: Warm Morning (golden but gritty)

**Items visible**: Boombox, cassette tapes, Cherry Coke can, CRT TV, mattress, mini-fridge

---

#### Scene 002: `home_starter_noon.png`

**Image prompt**: Same cramped studio apartment as home_starter_morning, midday. Flat harsh overhead light from bare bulb and window, every stain and crack visible on walls and floor. CRT TV showing static. No shadows to hide behind. Washed-out colors, institutional feel. The room looks worse in full light.

**Character note**: No characters visible.

**Mood/palette**: Harsh Noon (washed out, unflattering)

**Items visible**: Boombox, cassette tapes, Cherry Coke can, CRT TV, mattress, mini-fridge

---

#### Scene 003: `home_starter_night.png`

**Image prompt**: Same cramped studio apartment, nighttime. CRT TV casting flickering blue-white glow across the room, only light source besides dim streetlight through window. Deep shadows in corners. Boombox red LED power light glowing. Streetlight casts orange sliver through blinds. Deep blues, purples, cold TV glow. The room feels lonely and small.

**Character note**: No characters visible.

**Mood/palette**: Moody Night (cold, lonely, blue TV glow)

**Items visible**: Boombox (red LED), CRT TV (blue glow), mattress, mini-fridge

---

#### Scene 004: `home_upgraded_morning.png`

**Image prompt**: Decent one-bedroom apartment, morning. Real bed with wooden frame and proper bedding, larger TV on an actual stand, desk with scattered papers and cordless phone on wall-mount. Mini stereo system replacing the boombox. Cherry Coke six-pack on kitchen counter. Small potted plant on windowsill. Warm amber morning light through clean windows. Signs of progress and effort — still modest but dignified.

**Character note**: No characters visible.

**Mood/palette**: Warm Morning (amber, hopeful, clean)

**Items visible**: Stereo system, Cherry Coke six-pack, cordless phone, desk with papers, potted plant

---

#### Scene 005: `home_upgraded_noon.png`

**Image prompt**: Same upgraded one-bedroom apartment, bright afternoon. Clean and organized. Desk with cordless phone and stock paperwork spread out. Framed poster on wall (band or movie). Bright optimistic palette, natural light flooding in. The apartment of someone getting their life together.

**Character note**: No characters visible.

**Mood/palette**: Harsh Noon (but positive — bright, airy, optimistic)

**Items visible**: Cordless phone, stock paperwork, framed poster, stereo system

---

#### Scene 006: `home_upgraded_night.png`

**Image prompt**: Same upgraded apartment, nighttime. Warm desk lamp casting amber circle of light over papers. City skyline visible through window with twinkling lights in buildings. Stereo system glowing softly. Half-finished Cherry Coke can on desk. Cozy, lived-in, comfortable. A place worth coming home to.

**Character note**: No characters visible.

**Mood/palette**: Moody Night (warm variant — cozy amber lamp, twinkling city)

**Items visible**: Desk lamp, Cherry Coke can, stereo system, city skyline through window

---

#### Scene 007: `park_morning.png`

**Image prompt**: City park in early morning. Gravel walking path curving through scene, mature oak trees with dappled sunlight filtering through canopy. Wooden bench beside path. Small pond with ducks in middle distance. Joggers as small figures in background. Golden hour lighting with long shadows on grass. Soft greens, earth tones. Slightly misty, peaceful atmosphere.

**Character note**: No main characters visible. Background joggers only.

**Mood/palette**: Warm Morning (golden hour, peaceful greens)

**Items visible**: Wooden bench, pond, walking path, trees

---

#### Scene 008: `park_noon.png`

**Image prompt**: Same city park, bright midday. Full sun, vivid saturated greens on grass and trees. People sitting on benches, hot dog cart vendor with umbrella, pigeons on path. Pond sparkles with sunlight reflections. Blue sky with small clouds. Busy, alive, urban park energy.

**Character note**: No main characters. Background people as small pixel figures.

**Mood/palette**: Harsh Noon (vivid, bright, busy)

**Items visible**: Hot dog cart, benches, pond, pigeons

---

#### Scene 009: `park_night.png`

**Image prompt**: Same park at night. Yellow-orange vintage park lamps along the gravel path casting warm pools of light. Trees as dark silhouettes against deep navy sky with pixel stars. Wooden bench half-illuminated by nearest lamp. Pond reflects moonlight as silver-white pixels. Fireflies rendered as bright yellow-green single pixels scattered among trees. Serene, slightly magical.

**Character note**: No main characters visible.

**Mood/palette**: Moody Night (warm lamp pools against deep blue, firefly accents)

**Items visible**: Vintage lamps, bench, pond (moonlit), fireflies

---

#### Scene 010: `mall_noon.png`

**Image prompt**: 1990s shopping mall interior. Two-story atrium with escalators, central fountain with water, potted ficus trees in big planters, shiny tiled floors. Visible storefronts: record store, electronics shop with TVs in window, clothing store. Shoppers walking with bags. Food court visible in background. Fluorescent lighting from above. 1990s pastel color scheme — teals, pinks, mauve, cream tiles.

**Character note**: No main characters. Mall shoppers as background pixel figures.

**Mood/palette**: Harsh Noon (fluorescent, 90s pastels — teal, pink, mauve)

**Items visible**: Fountain, escalators, storefronts, shoppers

---

#### Scene 011: `mall_evening.png`

**Image prompt**: Same 1990s mall interior, evening. Thinning crowd, some stores closing with half-lowered metal security gates. Janitor with mop bucket working on the tile floor. Slightly dimmer lighting — some overhead panels off. Winding-down energy, echoing emptiness. Same pastel architecture but moodier.

**Character note**: No main characters. Janitor and few remaining shoppers.

**Mood/palette**: Moody Night (dimmer fluorescent, emptying out)

**Items visible**: Janitor with mop, half-closed storefronts, fountain (still running)

---

#### Scene 012: `cafe_morning.png`

**Image prompt**: Cozy independent 1990s cafe interior. Exposed red brick wall, mismatched wooden chairs and small round tables, chalkboard menu behind counter with hand-drawn items and prices. Chrome espresso machine on counter. Morning sunlight pouring through large street-facing windows. A few customers reading newspapers. Rich warm browns, reds from brick, golden sunlight. Inviting, authentic.

**Character note**: No main characters. Background customers only.

**Mood/palette**: Warm Morning (golden sunlight, rich browns, brick red)

**Items visible**: Espresso machine, chalkboard menu, wooden tables and chairs, newspapers

---

#### Scene 013: `cafe_noon.png`

**Image prompt**: Same cozy cafe, midday. Busier — more patrons at tables, short line at counter. Someone talking on a large brick-sized early 90s cell phone. Bright even lighting from windows. Steam rising from espresso machine. Lunch plates and coffee cups on tables. Same warm brick and wood, but energetic.

**Character note**: No main characters. Busy cafe patrons.

**Mood/palette**: Harsh Noon (bright, busy, warm)

**Items visible**: Espresso machine, cell phone user, lunch plates, coffee cups

---

#### Scene 014: `cafe_night.png`

**Image prompt**: Same cafe at night. Incandescent pendant lamps hanging over tables casting warm amber circles. Dark street visible outside windows with single streetlamp glow. Fewer patrons — intimate atmosphere. Small candles flickering on tables. Rich warm amber light, deep shadows between pools of light. Rain droplets on window glass catching light.

**Character note**: No main characters. A few quiet patrons.

**Mood/palette**: Moody Night (warm amber pendants, rain on glass, intimate)

**Items visible**: Pendant lamps, candles, rain on windows, espresso machine

---

#### Scene 015: `subway_morning.png`

**Image prompt**: Underground subway platform, 1990s. White tile walls with colored tile border stripe. Harsh fluorescent tube lights on ceiling. Morning commuters waiting — businesspeople with briefcases, workers. Busker with saxophone at far end of platform, small crowd gathered. Graffiti tag on support pillar. Flip-display schedule board showing times. Yellow safety line painted on platform edge. Train tracks below. Utilitarian, gritty, alive.

**Character note**: No main characters. Commuters and saxophone busker as background figures.

**Mood/palette**: Harsh Noon (fluorescent, tile white, utilitarian)

**Items visible**: Saxophone busker, flip-display board, graffiti, yellow safety line

---

#### Scene 016: `subway_night.png`

**Image prompt**: Same subway platform, nighttime. Nearly empty — one or two distant figures. Flickering fluorescent light (one tube buzzing, half-dark). Graffiti more prominent and visible. Small rat near track edge. Dark tunnel opening is pure black void. Sickly yellow-green fluorescent tones, cold whites, unsettling shadows. The underground feels dangerous and lonely.

**Character note**: No main characters. One or two distant figures.

**Mood/palette**: Moody Night (sickly fluorescent, unsettling, empty)

**Items visible**: Flickering light, graffiti, rat, dark tunnel

---

#### Scene 017: `downtown_morning.png`

**Image prompt**: Busy 1990s downtown street scene, morning. Brownstone buildings lining both sides, newsstand on corner with magazines and papers, yellow taxi cabs on road, businesspeople walking to work with briefcases. Red fire hydrant on sidewalk, steam rising from manhole cover. Golden morning light hitting upper floors of buildings while street level stays in cool shadow. Urban energy waking up.

**Character note**: No main characters. Business commuters and taxi drivers.

**Mood/palette**: Warm Morning (golden upper floors, cool street shadows)

**Items visible**: Newsstand, yellow cabs, fire hydrant, manhole steam, brownstones

---

#### Scene 018: `downtown_noon.png`

**Image prompt**: Same downtown street, bright midday. Full sun beating down. Hot dog vendor cart with umbrella on sidewalk. Bike messenger weaving through. Office workers on lunch break walking with takeout bags. Someone carrying a boombox on their shoulder. Vibrant, loud, maximum urban energy. Bright colors, harsh shadows, city at full speed.

**Character note**: No main characters. Street crowd as background figures.

**Mood/palette**: Harsh Noon (vibrant, hot, maximum energy)

**Items visible**: Hot dog cart, bike messenger, boombox carrier, office workers

---

#### Scene 019: `downtown_night.png`

**Image prompt**: Same downtown street at night. Neon signs from bars and shops reflecting off wet pavement (recent rain). Streetlights casting amber pools. Steam from manholes catching colored light. Film noir atmosphere. Neon pinks, blues, and greens glowing against dark brownstone buildings. Puddles act as mirrors for neon. Cinematic, moody, electric.

**Character note**: No main characters. A few silhouetted pedestrians.

**Mood/palette**: Neon Nightlife + Moody Night (neon reflections on wet streets, noir)

**Items visible**: Neon signs, wet pavement reflections, steam, streetlights

---

#### Scene 020: `pawnshop_interior.png`

**Image prompt**: Cluttered 1990s pawn shop interior. Glass display cases forming an L-shaped counter, filled with watches, jewelry, small electronics. Back wall covered with hanging guitars, leather jackets, tools, framed art. CRT security monitor behind counter showing grainy feed. Slow ceiling fan turning overhead. Brass cash register on counter. Dim warm overhead lighting with bright spots inside display cases. Cramped, treasure-trove energy. Browns, golds, warm amber.

**Character note**: No characters visible (Vinnie appears in NPC scenes).

**Mood/palette**: Warm Morning variant (dim amber, display case spotlights)

**Items visible**: Glass display cases, guitars on wall, leather jackets, cash register, CRT security monitor, ceiling fan

---

#### Scene 021: `brokerage_floor.png`

**Image prompt**: 1990s stock trading floor, wide view. Rows of desks with CRT monitors displaying green text on black screens. Traders in white shirts and suspenders shouting into corded phones, gesturing wildly. Ticker tape paper on floor. Charts and graphs pinned to walls. Large electronic stock board on far wall with scrolling red and green numbers. Fluorescent overhead lighting. Papers flying, controlled chaos. High energy, high stakes.

**Character note**: No main characters. Anonymous traders as background figures.

**Mood/palette**: Harsh Noon (fluorescent, green monitor glow, red/green numbers)

**Items visible**: CRT monitors, phones, ticker tape, stock board, charts on walls

---

#### Scene 022: `carlot_daytime.png`

**Image prompt**: Outdoor used car lot, bright 1990s daytime. Rows of boxy late-1980s/early-1990s sedans and coupes with big price stickers on windshields. Colorful triangular pennant banners strung overhead between poles. Small sales trailer/office with "CRAZY EDDIE'S" sign and "DEALS!" painted on window. Bright sun, hot asphalt with heat shimmer. Chrome bumpers gleaming. Americana energy.

**Character note**: No main characters. Maybe a salesman silhouette near trailer.

**Mood/palette**: Harsh Noon (bright sun, chrome gleam, hot asphalt)

**Items visible**: Cars with price stickers, pennant banners, sales trailer, "DEALS!" sign

---

#### Scene 023: `realestate_office.png`

**Image prompt**: Clean professional 1990s real estate office. Large mahogany desk as centerpiece. Beige desktop computer (boxy 90s tower + CRT monitor) on desk. Rolodex next to phone. Property listing sheets in neat stacks. Framed property photographs covering walls — houses, apartments, buildings. Healthy fern in ceramic pot in corner. Venetian blinds filtering warm afternoon light into horizontal stripes. Professional, polished, aspirational.

**Character note**: No characters visible (Mrs. Chen appears in NPC scenes).

**Mood/palette**: Warm Morning variant (filtered afternoon light, mahogany warmth)

**Items visible**: Mahogany desk, beige computer, Rolodex, property photos on walls, fern, venetian blinds

---

#### Scene 024: `nightclub_interior.png`

**Image prompt**: 1990s nightclub interior, wide view. Long bar on left with neon underglow (pink and blue). Dance floor center with colored light panels in the floor. Elevated DJ booth in back with turntables and massive speakers. Disco ball hanging from ceiling scattering light dots. Patrons dancing as silhouettes and pixel figures. VIP area on right roped off with velvet rope, plush booth seating. Haze of smoke catching colored light beams. Neon pink, electric blue, purple, laser green. Maximum nightlife energy.

**Character note**: No main characters. Dancing crowd and bartender as background.

**Mood/palette**: Neon Nightlife (full neon spectrum, smoke haze, disco ball)

**Items visible**: Neon bar, dance floor panels, DJ booth, disco ball, VIP rope area, speakers

---

#### Scene 025: `restaurant_interior.png`

**Image prompt**: Upscale 1990s Italian restaurant interior, evening. White tablecloths on round tables, each with a lit candle in glass holder. Wine rack wall visible in background. Rich dark wood paneling on walls. Couples dining at tables. Dim warm candlelight as primary illumination with subtle wall sconces. Dean Martin-era atmosphere. Deep reds, rich browns, golden candlelight reflections on glassware. Romantic, classy.

**Character note**: No main characters. Dining couples as background pixel figures.

**Mood/palette**: Moody Night (warm variant — candlelight, deep reds, romantic)

**Items visible**: Candlelit tables, white tablecloths, wine rack, wood paneling, wall sconces

---

### Category 2: Casino Scenes (6 scenes)

---

#### Scene 026: `casino_interior.png`

**Image prompt**: 1990s casino main floor interior, wide view. Expansive room with low ceiling and no windows. Slot machines in rows on left, card tables in center, roulette wheels on right. Thick cigarette smoke haze catching overhead spotlights. Patterned carpet (garish red and gold). Cocktail waitress carrying tray. Neon signs for different game areas. "THE GOLDEN ACE" in gold neon above entrance arch visible in background. Dark atmosphere punctuated by machine lights and table lamps. Smoke, neon, the sound of chips rendered as visual chaos.

**Character note**: No main characters. Casino patrons, dealers, and cocktail waitress as background figures.

**Mood/palette**: Neon Nightlife + Moody Night (smoke haze, garish carpet, gold neon, dark ceiling)

**Items visible**: Slot machines, card tables, roulette wheels, neon signs, patterned carpet, cocktail tray

---

#### Scene 027: `casino_slots.png`

**Image prompt**: Close view of a row of 1990s slot machines in the casino. Bulky cabinet-style machines with pull levers, three spinning reels visible through glass, flashing colored lights on top of each machine. Coin trays at bottom. One machine has "JACKPOT" lit up. Stool seats in front of machines. Garish carpet below. Overhead is dark. Each machine is a beacon of blinking color — reds, yellows, greens, blues. Hypnotic, addictive energy.

**Character note**: No main characters. Maybe one or two hunched gamblers on stools.

**Mood/palette**: Neon Nightlife (machine lights as primary illumination, dark surroundings)

**Items visible**: Slot machines with pull levers, spinning reels, coin trays, stools, flashing lights

---

#### Scene 028: `casino_blackjack.png`

**Image prompt**: Casino blackjack table, medium view looking across the green felt surface. Semi-circular table with card positions marked. Dealer's position at flat edge with card shoe and chip tray. Stacks of colored casino chips on felt. Two face-up playing cards visible. Overhead green-shaded lamp illuminating the table, rest of casino dark behind. Green felt dominates — rich gambling green. Focused, tense, intimate.

**Character note**: No main characters. Dealer's hands/position suggested.

**Mood/palette**: Moody Night (green felt glow, overhead lamp pool, dark surroundings)

**Items visible**: Green felt table, playing cards, casino chips, card shoe, overhead lamp

---

#### Scene 029: `casino_roulette.png`

**Image prompt**: Casino roulette table and wheel, medium view. Large wooden roulette wheel spinning (motion suggested by slight blur on ball). Green felt betting layout with red and black number grid. Stacks of chips placed on various numbers. Dealer's rake nearby. Overhead warm spotlight on the wheel. The wheel is the star — polished wood, alternating red and black pockets, ivory ball. Dramatic, suspenseful.

**Character note**: No main characters. Gamblers' hands placing chips suggested at table edge.

**Mood/palette**: Moody Night (spotlight on wheel, red/black contrast, dramatic)

**Items visible**: Roulette wheel, betting layout, casino chips, dealer's rake

---

#### Scene 030: `casino_win.png`

**Image prompt**: Casino scene, medium shot of a table covered in towering stacks of casino chips — reds, blues, blacks, golds. Chips spilling and scattered. Overhead lights seem brighter, warmer. Gold confetti-like sparkle pixels in the air. The table practically glows. Everything feels golden and triumphant. Winner's energy — the rare good moment in this place.

**Character note**: MC's hands visible at edge of frame, pulling chips toward himself. No full character render needed.

**Mood/palette**: Neon Nightlife + Warm (golden glow, triumph, sparkle)

**Items visible**: Towering chip stacks (multiple colors), scattered chips, golden sparkle effects

---

#### Scene 031: `casino_lose.png`

**Image prompt**: Casino scene, medium shot of an empty table. Almost no chips left — just a couple sad stacks. Ash tray with stubbed-out cigarette. Empty cocktail glass with melted ice. The overhead light seems dimmer, harsher. The garish carpet pattern feels oppressive. Background gamblers are blurry, indifferent. The emptiness of the table tells the whole story. Defeat, regret.

**Character note**: MC's hands visible at edge of frame, palms flat on empty felt. No full character render needed.

**Mood/palette**: Desaturated/Drained (dim, empty, regretful)

**Items visible**: Near-empty table, ashtray, empty glass, few remaining chips

---

### Category 3: NPC Interaction Scenes — Vinnie (5 scenes)

**Vinnie reference**: 50s, Italian-American, thick dark mustache going grey, rumpled button-down with rolled sleeves, slightly heavyset, warm eyes behind gruff exterior.

---

#### Scene 032: `vinnie_first_meeting.png`

**Image prompt**: Pawn shop interior, medium shot. Older heavyset man with thick dark mustache stands behind glass display counter, arms crossed over rumpled button-down shirt with rolled sleeves. He evaluates the viewer with skeptical but not unkind expression. Cluttered shelves of merchandise visible behind him. Warm dim overhead lighting. First impression — gruff gatekeeper of a treasure trove.

**Character note**: Vinnie is the focus. No MC visible (player POV). Vinnie: 50s, thick mustache, rumpled button-down, rolled sleeves, arms crossed, skeptical expression.

**Mood/palette**: Warm Morning variant (dim amber, cluttered warmth)

**Items visible**: Glass counter, merchandise shelves, Vinnie's rolled sleeves

---

#### Scene 033: `vinnie_showing_goods.png`

**Image prompt**: Pawn shop interior, medium shot across glass counter. Same mustachioed man now animated, gesturing with one hand at several items laid out on the glass counter top — a Casio watch, a Walkman, a gold chain necklace, a leather jacket folded. Showman energy, slight grin under mustache. Overhead spotlight creates bright pool on merchandise display. He is selling, and he is good at it.

**Character note**: Vinnie gesturing at goods. Items on counter are important — they should be recognizable as individual objects.

**Mood/palette**: Warm Morning (spotlight on merchandise, showman energy)

**Items visible**: Casio watch, Walkman, gold chain, leather jacket (on counter)

---

#### Scene 034: `vinnie_negotiating.png`

**Image prompt**: Pawn shop, close-up medium shot. Same mustachioed man leaning forward aggressively over counter, eyes narrowed, one eyebrow raised, index finger pointing toward viewer. Dramatic side-lighting from a desk lamp — half his face lit warm amber, half in deep shadow. Intense but with underlying respect. This is business. The negotiation face.

**Character note**: Vinnie in close-up negotiation pose. Dramatic chiaroscuro lighting on his face.

**Mood/palette**: Moody Night variant (desk lamp side-lighting, dramatic shadows)

**Items visible**: Desk lamp (light source), counter edge, Vinnie's pointing finger

---

#### Scene 035: `vinnie_friendly.png`

**Image prompt**: Pawn shop interior, medium shot. Same mustachioed man leaning casually on counter with one elbow, genuine warm smile visible under mustache. Holds a coffee mug in other hand. Small radio on counter behind him with pixel musical notes floating from it. Open, relaxed posture. The shop feels warmer, friendlier. A mentor, not just a merchant. Trust has been earned.

**Character note**: Vinnie relaxed and smiling. Coffee mug and radio are important props showing comfort/friendship.

**Mood/palette**: Warm Morning (inviting, friendly amber)

**Items visible**: Coffee mug, small radio (with music notes), counter

---

#### Scene 036: `vinnie_conspiratorial.png`

**Image prompt**: Pawn shop, close medium shot. Same mustachioed man leaning far over the glass counter toward the viewer, one hand cupped beside his mouth as if sharing a secret. Eyes darting to the sides checking if anyone else is listening. Dark shop background — only a single overhead light creates a tight pool around him. Conspiratorial, secretive, urgent. He has information.

**Character note**: Vinnie in secretive pose. The "I have to tell you something" body language is key.

**Mood/palette**: Moody Night (single overhead light pool, dark surroundings, secretive)

**Items visible**: Glass counter, overhead light, dark shop background

---

### Category 4: NPC Interaction Scenes — Diana (9 scenes)

**Diana reference**: Early 20s, expressive eyes, creative messy auburn/reddish hair, headphones always around neck, band tee under denim jacket, sketchbook nearby, Cherry Coke is her drink.

---

#### Scene 037: `diana_first_sighting.png`

**Image prompt**: Cafe interior, medium-wide shot. Young woman sitting alone at a window table, completely absorbed in sketching in her sketchbook. Creative messy reddish hair, headphones around her neck, band tee visible. Cherry Coke with a straw sits beside her sketchbook. Afternoon sunlight through the window creates a golden halo effect around her. She has not noticed the viewer. Dreamy, golden, the moment before everything changes.

**Character note**: Diana is the focus. She is NOT looking at the camera — absorbed in her art. The Cherry Coke and sketchbook are signature props. Headphones around neck are always visible.

**Mood/palette**: Warm Morning (golden afternoon halo, dreamy, romantic introduction)

**Items visible**: Sketchbook, Cherry Coke with straw, headphones around neck, cafe window

---

#### Scene 038: `diana_first_conversation.png`

**Image prompt**: Cafe interior, medium shot across a small round table. Same young woman with messy reddish hair and headphones around neck, now looking up from her sketchbook with a surprised but curious half-smile. Pencil paused in hand. Making direct eye contact with the viewer/camera. Warm cafe lighting from pendant lamps. She is welcoming but slightly guarded — sizing you up. The first real connection.

**Character note**: Diana making eye contact. Surprised but intrigued expression. Pencil in hand, sketchbook open.

**Mood/palette**: Warm Morning (cafe warmth, eye contact moment)

**Items visible**: Sketchbook (open), pencil, Cherry Coke, pendant lamp light

---

#### Scene 039: `diana_coffee_date.png`

**Image prompt**: Cafe interior, medium shot of two people at a small round table. Young woman with messy reddish hair and headphones around neck, laughing — genuine, eyes crinkled. Her Cherry Coke in front of her. Young man across from her leaned forward, engaged. His coffee cup in front of him. Sketchbook closed and set aside. Warm cafe lighting wraps them. Two people discovering each other. Early romance energy — comfortable, electric.

**Character note**: Diana laughing, MC leaned forward. Both visible. Her Cherry Coke, his coffee. Sketchbook closed = she is fully present. This is the "it's going well" scene.

**Mood/palette**: Warm Morning (warm wrap-around light, romantic comfort)

**Items visible**: Cherry Coke, coffee cup, closed sketchbook, cafe table

---

#### Scene 040: `diana_park_walk.png`

**Image prompt**: City park, wide medium shot. Young woman with messy reddish hair and headphones around neck walking beside a young man with dark hair and sunglasses pushed up on his head, on a gravel path under trees. She is gesturing animatedly with her hands, telling a story. Autumn leaves falling around them — oranges, reds, yellows. Warm golden-green dappled sunlight through canopy. Romantic, natural, alive. Two people falling in love without saying it.

**Character note**: Diana and MC walking together. She is animated and expressive. He is listening, engaged. Autumn leaves are important — seasonal romance. Both full-body, 40-50px tall.

**Mood/palette**: Warm Morning (golden-green, autumn leaves, dappled light)

**Items visible**: Autumn leaves (falling), gravel path, trees, park bench in background

---

#### Scene 041: `diana_dinner_date.png`

**Image prompt**: Upscale Italian restaurant, medium shot. Candlelit table with white tablecloth. Young woman with reddish hair sitting across from young man. She is dressed slightly nicer than usual but still creative — headphones still around her neck (always). Candle flame dances, casting warm flickers on both their faces. Wine glasses on table. Deep romantic lighting — warm amber candle against deep brown/red restaurant interior. The dinner scene.

**Character note**: Diana and MC at dinner. She keeps her headphones (her identity). Candlelight on both faces is critical. Wine glasses suggest sophistication growth.

**Mood/palette**: Moody Night (warm candlelight, deep reds/browns, romantic)

**Items visible**: Candle, wine glasses, white tablecloth, headphones around Diana's neck

---

#### Scene 042: `diana_love_confession.png`

**Image prompt**: Park at night, medium close shot. Two people sitting close together on a wooden bench under a vintage cast-iron park lamp. Young woman with reddish hair and headphones around neck looks vulnerable and hopeful, turned toward the young man. Fireflies as bright yellow-green pixels floating around them. Warm amber lamplight against deep blue-purple night sky. Intimate, tender, the moment hearts open. The most emotionally delicate scene.

**Character note**: Diana and MC on bench. She looks vulnerable — this is her risking something. Fireflies create magic. The lamp is their private world in the dark park.

**Mood/palette**: Moody Night (warm lamp bubble in deep blue night, fireflies, tender)

**Items visible**: Park bench, vintage lamp, fireflies, night sky with stars

---

#### Scene 043: `diana_proposal.png`

**Image prompt**: Restaurant interior, medium shot. Young man with dark hair on one knee beside the table, holding an open ring box — the ring catches and sparkles with candlelight. Young woman with reddish hair and headphones around neck has both hands over her mouth, eyes wide, tears catching warm light. Other restaurant patrons are slightly blurred but turned to look. Maximum warmth in the color palette. Cinematic, the biggest emotional moment. Every pixel should feel golden.

**Character note**: MC on one knee with ring box. Diana's reaction is the emotional center — hands over mouth, tears of joy. Other patrons watching adds social weight. The ring sparkle is the brightest point in the scene.

**Mood/palette**: Warm Morning at maximum (golden everything, sparkle on ring, tears catching light)

**Items visible**: Ring box (open, sparkling), candle, table setting, wine glasses

---

#### Scene 044: `diana_breakup.png`

**Image prompt**: Upgraded apartment interior, medium shot. Young woman with reddish hair standing at the open door, arms crossed, expression hurt and angry. Headphones are in her bag — she has already packed. Young man across the room, defensive posture. Physical distance between them is emphasized — they are far apart in the frame. Despite the warm desk lamp being on, the scene feels cold. Color is drained from the palette. She is leaving. It is over.

**Character note**: Diana at door (leaving), MC across room (staying). The physical gap between them IS the story. Her headphones in bag = she was already preparing to go. Desaturated despite warm lamp.

**Mood/palette**: Desaturated/Drained (cold despite lamp, emotional distance)

**Items visible**: Open door, Diana's bag (with headphones inside), desk lamp (warm but insufficient)

---

#### Scene 045: `diana_win_ending.png`

**Image prompt**: Rooftop at sunrise, wide shot. Young woman with reddish hair resting her head on the shoulder of a young man with dark hair. They stand at a rooftop railing looking out at a spectacular sunrise over the city skyline. Orange, pink, and gold sunrise light painting the sky and their silhouettes. Her headphones catch and reflect the first golden light of dawn. The entire city spread below them. Triumphant, peaceful, earned. Everything was worth it.

**Character note**: Diana and MC together at railing. Her head on his shoulder = intimacy earned. Headphones catching sunrise light is a signature detail. They are small against the vast hopeful sky — the city they conquered together.

**Mood/palette**: Warm Morning at maximum (full sunrise spectrum — violet through pink through orange through gold)

**Items visible**: Rooftop railing, city skyline, sunrise, headphones catching light

---

### Category 5: NPC Interaction Scenes — Marcus (5 scenes)

**Marcus reference**: Early 30s, slicked-back dark hair, white dress shirt, suspenders, loosened tie, pager on belt, sharp features, Wall Street confidence.

---

#### Scene 046: `marcus_first_meeting.png`

**Image prompt**: Cafe interior, medium shot. Sharply dressed young man with slicked-back dark hair sitting at a table with a small espresso cup. Suspenders visible over white shirt, tie loosened. Pager clipped to belt visible. Newspaper folded to the stock pages beside his cup. Confident, sharp smile — he knows something you do not. Cool confidence radiates. Crisp whites, espresso browns, the polish of ambition.

**Character note**: Marcus at cafe. Pager on belt, newspaper folded to stocks, espresso — all signature props. His confidence should contrast with the humble cafe setting.

**Mood/palette**: Warm Morning (cafe warmth, but Marcus brings cool sharpness)

**Items visible**: Espresso cup, pager on belt, newspaper (stock pages), suspenders

---

#### Scene 047: `marcus_brokerage_intro.png`

**Image prompt**: Brokerage trading floor, medium-wide shot. Same slicked-hair man in suspenders standing with arms spread wide in a "welcome to my world" gesture, broad grin. Behind him: traders shouting into phones, CRT screens flickering with green numbers, papers flying through the air. He is the calm confident center of a storm of chaos. He belongs here. You are the guest.

**Character note**: Marcus arms-spread welcoming gesture. He is composed while everything behind him is chaos. The contrast between his calm and the trading floor madness is the point.

**Mood/palette**: Harsh Noon (fluorescent chaos behind, Marcus as focal calm)

**Items visible**: CRT monitors, traders with phones, flying papers, stock board

---

#### Scene 048: `marcus_stock_tip.png`

**Image prompt**: Tight medium shot. Same slicked-hair man leaning close to the viewer, hand cupped beside his mouth, eyes bright and knowing. Pager in his other hand — it just buzzed with information. Background is dimmed and out of focus. Dramatic warm side lighting from one direction. Insider knowledge energy — this is the tip that changes everything. Or so he says.

**Character note**: Marcus in close-up sharing a secret. Pager in hand is important — it is his source. The intimacy of the framing suggests trust (or manipulation). Side lighting creates drama.

**Mood/palette**: Moody Night variant (dramatic side-light, dimmed background, intensity)

**Items visible**: Pager (in hand, recently buzzed), Marcus's cupped hand

---

#### Scene 049: `marcus_betrayal_reveal.png`

**Image prompt**: Brokerage private office, tense medium shot. Same slicked-hair man behind a desk, caught in the act. Papers scattered across desk, one incriminating document prominently visible. His expression shifts from shock to rapid calculation — how to spin this. Cold harsh fluorescent lighting, no warmth anywhere. Sterile whites, cold blues. The suspenders and loosened tie now look like a costume, not confidence. Everything fake revealed.

**Character note**: Marcus caught. The shift from confident to cornered is the key expression. Papers scattered = evidence of wrongdoing. The cold lighting strips away all his warm charisma.

**Mood/palette**: Desaturated/Drained (cold fluorescent, sterile, no warmth, betrayal revealed)

**Items visible**: Scattered papers, incriminating document, desk, cold fluorescent lights

---

#### Scene 050: `marcus_confession.png`

**Image prompt**: Dim bar or office, medium shot. Same man but transformed — slumped in a chair, head down, hands hanging between his knees. Suspenders hanging loose off shoulders. Tie completely undone. Slicked hair has fallen forward, disheveled. Whiskey glass on table beside him, half empty. Single dim lamp provides only light. Completely defeated, genuinely remorseful. Desaturated palette — all the sharp colors drained out of him. A broken man being honest for the first time.

**Character note**: Marcus at his lowest. Every detail of his appearance that was once sharp is now undone — hair, tie, suspenders, posture. The whiskey glass suggests he has been here a while. This is the real Marcus, stripped of performance.

**Mood/palette**: Desaturated/Drained (single dim lamp, everything muted, defeated)

**Items visible**: Whiskey glass, loose suspenders, dim lamp, chair

---

### Category 6: NPC Interaction Scenes — Ray (6 scenes)

**Ray reference**: Late 20s, wiry build, leather jacket, dark jeans, boots, aviator sunglasses (often pushed up on forehead), toothpick in mouth corner, street-smart energy.

---

#### Scene 051: `ray_first_meeting.png`

**Image prompt**: City park, medium shot. Wiry young man in leather jacket leaning against a thick oak tree trunk, one boot flat against the bark. Aviator sunglasses pushed up on forehead, toothpick in corner of mouth. He is scanning the area, then makes eye contact with the viewer. Dappled shade from tree canopy. Cool tones on him (leather black, denim blue) contrast with warm park greens around him. Guarded, street-smart, sizing you up. A predator who might be an ally.

**Character note**: Ray leaning on tree. His cool dark clothing against the warm green park creates visual tension — he does not belong here, but this is his office. Toothpick and pushed-up aviators are signature details.

**Mood/palette**: Warm Morning (park greens) vs. cool character (leather blacks, denim blues)

**Items visible**: Oak tree, leather jacket, aviator sunglasses (on forehead), toothpick

---

#### Scene 052: `ray_pitching_deal.png`

**Image prompt**: Park or alley setting, tight medium shot. Same wiry man in leather jacket leaning in very close, one hand on the viewer's shoulder (arm extending toward camera). Intense eyes locked on, toothpick shifted to side of mouth. Background is darker — they have moved aside from the main path into shadow. Noir-style side lighting creates deep shadows on half his face. Deep shadows, cool blues and blacks. Persuasive, slightly dangerous. "I got something for you."

**Character note**: Ray in his element — the pitch. Hand on shoulder = physical manipulation/intimacy. The darkness of the setting contrasts with the park scenes. This is the shady side.

**Mood/palette**: Moody Night (noir side-lighting, deep shadows, dangerous intimacy)

**Items visible**: Ray's hand (reaching toward viewer), leather jacket, dark background

---

#### Scene 053: `ray_deal_success.png`

**Image prompt**: Downtown street or park, medium shot. Same wiry man in leather jacket grinning wide — a real genuine grin for once. Handing a fat envelope stuffed with cash bills toward the viewer with one hand. Other hand giving a thumbs up. Brighter lighting than any other Ray scene. Warmer color palette than usual — even his leather jacket looks less menacing. Relief and celebration. The hustle paid off.

**Character note**: Ray happy. The grin should feel genuine and different from his usual smirk. The cash envelope is the focal prop. Brighter/warmer than all other Ray scenes shows the rare good outcome.

**Mood/palette**: Warm Morning (brighter than usual, relief, celebration)

**Items visible**: Cash envelope (fat, bills visible), Ray's thumbs up

---

#### Scene 054: `ray_deal_failure.png`

**Image prompt**: Same location, medium shot. Same wiry man in leather jacket, but now hands up in apologetic surrender, looking down and to the side — cannot meet the viewer's eyes. Collar turned up defensively, shoulders hunched. Toothpick gone (nervous habit). Darker lighting, overcast feeling. Muted cool palette — blues, greys. Guilt written in every pixel of his posture. "I'm sorry, man."

**Character note**: Ray in defeat. Cannot make eye contact = shame. Missing toothpick = nervous breakdown of his cool facade. Turned-up collar = retreat into himself. The contrast with the success scene should be stark.

**Mood/palette**: Desaturated/Drained (overcast, muted cool, guilt)

**Items visible**: Ray's raised hands (apologetic), leather jacket (collar up)

---

#### Scene 055: `ray_family_crisis.png`

**Image prompt**: Park, medium shot. Same wiry man sitting on a park bench, hunched forward with elbows on knees, head in his hands. Crumpled letter clutched in one hand. No sunglasses on face or forehead — they are gone, and with them his armor. No toothpick. Leather jacket open, posture completely open and vulnerable. Late afternoon light casts long golden shadows. Warm but deeply melancholy golden light. The bravado is gone. This is just a scared person.

**Character note**: Ray at his most vulnerable. No sunglasses, no toothpick = stripped of all his tough-guy props. The crumpled letter is about his daughter's medical bills. This is the only time we see Ray as a real person, not a character.

**Mood/palette**: Warm Morning variant (late afternoon, golden but melancholy)

**Items visible**: Crumpled letter, park bench, Ray's bare face (no sunglasses)

---

#### Scene 056: `ray_grateful.png`

**Image prompt**: Park or downtown, medium shot. Same wiry man but transformed — standing up straight for the first time in any scene. Genuine warm smile replacing his usual smirk. Leather jacket open, posture open and relaxed. One hand extended for a handshake or placed over his heart. Aviators back on forehead but the eyes are honest. This is the warmest, brightest Ray scene ever rendered. He has been changed by kindness. The toothpick is back, but the wall is down.

**Character note**: Ray transformed. Standing straight (first time!) = dignity restored. Open posture = trust. This should be visually the warmest Ray scene — proving that the character arc worked. Handshake or hand-on-heart gesture.

**Mood/palette**: Warm Morning at maximum (brightest Ray scene, genuine warmth)

**Items visible**: Extended hand (handshake), open leather jacket, aviators on forehead

---

### Category 7: NPC Interaction Scenes — Mrs. Chen (4 scenes)

**Mrs. Chen reference**: 40s, Asian woman, structured navy blazer, pearl earrings, elegant glasses, perfect posture, professional but warm, evaluating intelligence.

---

#### Scene 057: `chen_office_intro.png`

**Image prompt**: Real estate office, medium shot across mahogany desk. Professional Asian woman in structured navy blazer with pearl earrings, looking over elegant glasses at the viewer with an evaluating expression. Perfect posture in her leather office chair. Brass nameplate reading "S. CHEN" on desk front. Neatly organized papers, beige desktop computer visible. Professional warm lighting through venetian blinds. Navy blazer, cream walls, mahogany desk — composed, polished, intimidating through competence.

**Character note**: Mrs. Chen evaluating the player. Looking over glasses = sizing you up. Perfect posture = standards. The nameplate grounds her identity. She is professional warmth — not cold, but you must earn her respect.

**Mood/palette**: Warm Morning variant (professional filtered light, mahogany warmth)

**Items visible**: "S. CHEN" nameplate, mahogany desk, computer, venetian blinds, pearl earrings

---

#### Scene 058: `chen_showing_listings.png`

**Image prompt**: Same office, medium shot. Same professional woman, now engaged and animated. She has turned her CRT monitor to face the viewer, and property listing sheets are spread across the mahogany desk. Pointing at a listing with a pen in hand. Glasses reflect the monitor screen slightly. Pops of color from the property photographs on the sheets. Engaged, professional, showing you the possibilities.

**Character note**: Mrs. Chen in work mode. Monitor turned toward player and pen pointing = she is including you in the process. Glasses reflecting monitor is a nice detail. The property listings should have visible small photos.

**Mood/palette**: Warm Morning (engaged, professional warmth, colorful listing photos)

**Items visible**: Property listing sheets (with small photos), CRT monitor (turned), pen, glasses

---

#### Scene 059: `chen_closing_deal.png`

**Image prompt**: Same office, medium shot. Same professional woman standing behind desk, extending hand for a handshake across the desk. Satisfied professional smile — restrained but genuine. A property listing on the desk prominently stamped "SOLD" in red. Lighting is slightly brighter and warmer than the intro scene — success warms the room. Achievement, milestone, mutual respect.

**Character note**: Mrs. Chen handshake. The "SOLD" stamp is the focal detail. Her smile is professional — she does not gush, but you can tell she is pleased. The handshake = you have earned respect.

**Mood/palette**: Warm Morning (slightly brighter/warmer than usual, success energy)

**Items visible**: "SOLD" stamped listing, extended handshake, desk

---

#### Scene 060: `chen_crown_jewel.png`

**Image prompt**: Same office, tight medium shot. Same professional woman has removed her glasses — a first. Barely contained excitement breaking through her professional composure. She is sliding a special embossed leather folder across the mahogany desk toward the viewer. The folder seems to have its own warm golden glow — this is THE property. Dramatic warm gold tones permeate the scene. Her eyes gleam. This is the prize she has been saving for the right buyer.

**Character note**: Mrs. Chen breaking composure for the first time. Glasses removed = this is personal, not just business. The glowing folder is almost magical — this is the crown jewel property. Her excitement breaking through professionalism shows this matters to her too.

**Mood/palette**: Warm Morning at maximum (golden glow from folder, excitement, special moment)

**Items visible**: Embossed leather folder (glowing), removed glasses (on desk), gleaming eyes

---

### Category 8: NPC Interaction Scenes — Tony (5 scenes)

**Tony reference**: 40s, large/stocky build, multiple gold chains over open silk shirt, rings on multiple fingers, broad infectious smile, larger-than-life energy, nightclub owner king.

---

#### Scene 061: `tony_nightclub_intro.png`

**Image prompt**: Nightclub entrance area, medium-wide shot. Large stocky man with multiple gold chains over open silk shirt, rings glinting on fingers, standing with arms spread wide in an expansive welcome gesture. Broad charismatic grin. Dance floor with neon lights and moving bodies visible behind him. He is backlit by neon — creating a colorful silhouette halo — while his face is lit warmly from the front. Flashy, electric, larger-than-life. The king of this neon kingdom welcomes you.

**Character note**: Tony in full showman mode. Arms-wide gesture = he owns this space and is sharing it. Gold chains and silk shirt catch neon light. Neon backlighting creates halo effect. He should visually dominate the frame despite the busy background.

**Mood/palette**: Neon Nightlife (full neon spectrum backlighting, warm face light, electric)

**Items visible**: Gold chains, silk shirt, neon lights, dance floor behind, rings

---

#### Scene 062: `tony_vip_chat.png`

**Image prompt**: Nightclub VIP booth, medium shot. Same large man reclined comfortably in plush velvet booth seating, one arm draped along the booth back. Cocktail glass in other hand. Gold chains catch different colored neon reflections. Velvet rope visible at edge of frame marking VIP boundary. Bottle service on the table — champagne in ice bucket. Dance floor and lights visible but separated in background. Deep purples, velvet reds, gold highlights. Exclusive, insider energy.

**Character note**: Tony relaxed in his domain. VIP booth = inner sanctum. Reclined posture = confidence and comfort. Cocktail in hand = hospitality. The velvet rope literally separates his world from the common floor.

**Mood/palette**: Neon Nightlife (deep purple, velvet red, gold accents, exclusive)

**Items visible**: Velvet booth, cocktail glass, champagne in ice bucket, velvet rope, gold chains

---

#### Scene 063: `tony_partnership_offer.png`

**Image prompt**: VIP area or back office, medium shot. Same large man leaning forward across a table, both hands flat on the surface, face serious — the big grin is gone. A contract document on the table between his hands. Gold chains hang forward from his chest. Less neon in this scene — more warm lamp light, like a real office hidden behind the party. Business intensity. He is offering you something real, and he needs you to understand the weight of it.

**Character note**: Tony serious for the first time. No smile = this is real. Hands flat on table = grounding, authority. Contract visible = tangible stakes. The shift from neon to lamp light signals "this is business, not party."

**Mood/palette**: Moody Night (warm lamp replacing neon, serious, business intensity)

**Items visible**: Contract document, table, lamp, gold chains (hanging forward)

---

#### Scene 064: `tony_major_deal.png`

**Image prompt**: Private back office or VIP corner, tight medium shot. Same large man very close to the viewer, speaking in a low voice, one finger pointed for emphasis. Dead serious expression — eyes intense, jaw set. Single warm light source from one side creating strong chiaroscuro. Gold chains visible as armor, not decoration. The background is almost black. This is the highest stakes conversation. One wrong word changes everything.

**Character note**: Tony at maximum intensity. The close framing = pressure. Pointed finger = "listen to me." Chiaroscuro lighting = moral ambiguity. Gold chains as armor = he is protected, you are exposed. This is the $50K deal pitch.

**Mood/palette**: Moody Night (chiaroscuro, single warm source, near-black background)

**Items visible**: Tony's pointed finger, gold chains, single light source, darkness

---

#### Scene 065: `tony_celebration.png`

**Image prompt**: Nightclub VIP area, medium-wide shot. Same large man popping a champagne bottle — spray arcing through the air and catching neon lights in a rainbow of color. His widest grin yet. Other people in the VIP area cheering, raising glasses. Dance floor packed with dancers visible behind. Maximum neon joy — every color firing. Champagne spray sparkles like liquid gold in the neon light. Gold chains catch every color. The deal worked. Tonight, everyone wins.

**Character note**: Tony celebrating. Champagne pop is the centerpiece — spray catching neon creates rainbow effect. His joy is infectious — other people are cheering. This is the peak nightclub moment in the entire game. Maximum color, maximum energy.

**Mood/palette**: Neon Nightlife at maximum (every neon color, champagne sparkle, gold, celebration)

**Items visible**: Champagne bottle (spraying), glasses raised, dance floor, neon lights at maximum, gold chains

---

### Category 9: Activity/Action Scenes (10 scenes)

---

#### Scene 066: `activity_mall_buying.png`

**Image prompt**: Mall thrift/secondhand section, medium shot. Cluttered bin and rack display with various items visible — a Walkman, watches, a jacket, sunglasses, electronics. Young man with dark hair browsing, holding up an item to examine it. Fluorescent overhead lighting, colorful jumble of merchandise. Price tags visible. The thrill of the treasure hunt — finding gold in the junk. Bright mall pastels, colorful item variety.

**Character note**: MC browsing secondhand goods. He should be examining an item with interest. The variety of items in the bin/rack should suggest the range of flip-able merchandise.

**Mood/palette**: Harsh Noon (fluorescent mall lighting, colorful merchandise)

**Items visible**: Walkman, watches, sunglasses, jacket, price tags, bins/racks

---

#### Scene 067: `activity_pawnshop_selling.png`

**Image prompt**: Pawn shop, medium shot across glass counter. Young man's hands visible placing an item on the glass counter surface. Mustachioed older man on the other side examining it closely with a jeweler's loupe/squinting eye. Cash register nearby with the cash drawer suggestively close. Warm focused lighting from display case spotlights. The moment of appraisal — will the price be right?

**Character note**: MC and Vinnie in transaction. Focus is on the item between them and Vinnie's evaluation. The cash register nearby implies the impending payout. Tension of "what's it worth?"

**Mood/palette**: Warm Morning (focused display lighting, transaction tension)

**Items visible**: Item on counter (generic), jeweler's loupe, cash register, glass counter

---

#### Scene 068: `activity_stock_trading.png`

**Image prompt**: Brokerage floor, over-the-shoulder shot from behind a young man sitting at a desk. He stares at a CRT monitor with green text on black — stock tickers, numbers, graphs. One hand hovers over a phone receiver, about to make the call. Large electronic stock board on the wall ahead shows red and green numbers updating. Green monitor glow reflecting on his face. Heart-pounding tension — buy or sell?

**Character note**: MC from behind/over-shoulder. The CRT screen and his hovering hand on the phone are the focus. Green glow on face = bathed in the data. The wall board adds scale and urgency.

**Mood/palette**: Moody Night variant (green CRT glow, red/green numbers, tension)

**Items visible**: CRT monitor (green text), phone receiver, stock board (red/green), desk

---

#### Scene 069: `activity_buying_car.png`

**Image prompt**: Used car lot, medium-wide shot. Young man with dark hair standing next to a car, kicking the tire or checking under the hood. Car salesman in a bad plaid suit gesturing expansively at the car's features. Pennant banners overhead. Price sticker visible on windshield. Bright daylight, shiny car paint catching sun. A milestone moment — your first real purchase. The car represents progress.

**Character note**: MC and car salesman (minor NPC — bad suit, big gestures). The car itself is important — boxy late-80s/early-90s model, not fancy but it runs. Price sticker on windshield grounds the transaction.

**Mood/palette**: Harsh Noon (bright sun, chrome gleam, car lot energy)

**Items visible**: Car (with price sticker), pennant banners, salesman, car hood/tire

---

#### Scene 070: `activity_signing_papers.png`

**Image prompt**: Office desk, close medium shot focused on hands and paperwork. Young man's hand holding a pen, signing a formal document. Across the desk, a woman's hands (Mrs. Chen's) holding the edge of the paper steady. Notary stamp, duplicate copies, fancy pen visible on the desk. Warm desk lamp lighting the signing area. This is official. Pen meets paper. A life-changing signature.

**Character note**: Close-up on hands and documents — MC signing, Mrs. Chen assisting. Faces may not be fully visible. The focus is on the act of signing. The notary stamp adds legal weight.

**Mood/palette**: Warm Morning (desk lamp, warm paper tones, momentous)

**Items visible**: Document (being signed), pen, notary stamp, duplicate copies, desk lamp

---

#### Scene 071: `activity_cherry_coke.png`

**Image prompt**: Home interior (starter or upgraded), medium shot. Young man with dark hair sitting back in a chair or on mattress/couch, feet kicked up, drinking a Cherry Coke from a red can. Boombox or stereo playing nearby with pixel musical notes floating from speakers. Completely relaxed posture. The red Cherry Coke can is the brightest color pop in the scene. Comfort, small pleasures, stress relief. A moment of peace in the hustle.

**Character note**: MC relaxing. The Cherry Coke can should be prominently red — the focal color. Musical notes from speakers = soundtrack to relaxation. This is the "reset" scene — stress melting away.

**Mood/palette**: Warm Morning (comfort, the red can as warm accent)

**Items visible**: Cherry Coke can (red, prominent), boombox/stereo, musical notes, relaxed seating

---

#### Scene 072: `activity_boombox.png`

**Image prompt**: Home interior, medium shot. Young man sitting on the floor next to a large boombox, pressing the play button. Cassette tapes scattered around him on the floor. Eyes closed, head slightly bobbing to the beat. Pixel musical notes emanating from the boombox speakers. Warm lighting in the room. The boombox's LED display and buttons glow. Nostalgic, meditative, music as medicine.

**Character note**: MC on floor with boombox. Eyes closed = fully immersed in music. Scattered tapes = a collection, a passion. The boombox should be detailed and prominent — it is an important game item.

**Mood/palette**: Warm Morning (warm room light, LED glow, nostalgic)

**Items visible**: Boombox (detailed, LED glow), cassette tapes (scattered), musical notes

---

#### Scene 073: `activity_park_walk.png`

**Image prompt**: City park, wide shot with plenty of breathing room. Young man walking alone on the gravel path, hands in pockets, contemplative downward gaze. Trees, birds on branches, pond in background. Soft peaceful lighting — not too bright, not too dim. Greens, earth tones, gentle sky blue. Space and silence. The walk that clears the mind. Restorative, meditative.

**Character note**: MC alone, walking. Small in the frame to emphasize the space around him. Hands in pockets = processing thoughts. The emptiness of the frame IS the point — room to breathe.

**Mood/palette**: Warm Morning (soft, peaceful, gentle greens and blues)

**Items visible**: Gravel path, trees, birds, pond, open sky

---

#### Scene 074: `activity_food_court.png`

**Image prompt**: Mall food court, medium shot. Young man sitting at a small table with a tray: burger, french fries, large soda cup. Food vendor stalls visible behind — Chinese food, pizza, burgers — each with neon menu signs and warming lamps. Other diners at nearby tables. Fluorescent lighting from above. Fast food color palette — reds, yellows, oranges from the vendors. Simple pleasure, people watching, fuel for the hustle.

**Character note**: MC eating alone at food court. The tray of food is a simple comfort. Background vendor stalls with neon menus add visual variety and 90s mall atmosphere.

**Mood/palette**: Harsh Noon (fluorescent, fast food reds/yellows/oranges)

**Items visible**: Burger, fries, soda cup, food vendor stalls, neon menu signs

---

#### Scene 075: `activity_nightclub_dancing.png`

**Image prompt**: Nightclub dance floor, medium shot. Young man among a crowd of dancers, colored spotlights sweeping across the floor. DJ booth visible in background with turntables. Motion blur or afterimage effect on dancers to suggest movement. Colored pixel waves emanating from speakers. Disco ball scattering dots of light. Maximum neon energy — this is freedom expressed through motion and light and bass.

**Character note**: MC dancing in crowd. He should be recognizable but part of the crowd — the music is bigger than any one person. Motion effects suggest the energy. Speaker waves add visual rhythm.

**Mood/palette**: Neon Nightlife (full spectrum, motion effects, disco ball scatter)

**Items visible**: DJ booth, speakers (with visual waves), disco ball, colored spotlights, dancers

---

### Category 10: Random Event Scenes (5 scenes)

---

#### Scene 076: `event_found_wallet.png`

**Image prompt**: Park path, close medium shot angled downward. A brown leather wallet lying on the gravel path, partially open showing green bills inside. The edge of MC's sneakers visible at bottom of frame. Dappled sunlight making the wallet's contents glint. The wallet has a subtle warm highlight making it stand out from the path. A moral decision sitting on the ground.

**Character note**: MC not fully visible — just shoes at frame edge. The wallet is the star. The visible cash inside creates the dilemma.

**Mood/palette**: Warm Morning (dappled light, moral weight)

**Items visible**: Leather wallet (open, bills visible), gravel path, MC's sneakers (edge)

---

#### Scene 077: `event_street_musician.png`

**Image prompt**: Subway platform, medium shot. Older Black man wearing a fedora and worn but dignified suit, playing a saxophone with eyes closed in deep feeling. Pixel musical notes float upward from the instrument. Open instrument case on the ground in front of him with scattered coins and a few bills. The cold tile and fluorescent station around him versus the warm golden aura his music creates — two temperature zones in one image.

**Character note**: Saxophone busker is the focus — not a main NPC, but rendered with dignity and detail. The contrast between cold station and warm music aura is the visual story.

**Mood/palette**: Mixed — cold station (fluorescent, tile) vs. warm music aura (golden around musician)

**Items visible**: Saxophone, fedora, open instrument case (coins and bills), musical notes

---

#### Scene 078: `event_mugging_attempt.png`

**Image prompt**: Downtown alley at night, tense medium shot. Shadowy figure in dark hoodie stepping out from an alley, one hand extended toward the viewer in a "give it up" gesture. Harsh single streetlight overhead casting dramatic hard shadows. MC visible at edge of frame, body language startled and tense. Brick walls of alley, dumpster, fire escape ladder. Deep noir tension. Ominous reds in the shadows, threatening darkness. "Empty your pockets."

**Character note**: Mugger is anonymous — hooded, faceless shadow. MC startled. The single harsh streetlight creates the entire dramatic composition. This is the most dangerous scene in the game.

**Mood/palette**: Moody Night (noir, harsh single streetlight, threatening reds/blacks)

**Items visible**: Mugger's extended hand, streetlight, alley walls, dumpster, fire escape

---

#### Scene 079: `event_cherry_coke_sale.png`

**Image prompt**: Mall interior, medium shot. Elaborate Cherry Coke promotional display — a pyramid stack of red Cherry Coke cans, life-size cardboard standee of a cool 90s character, big "SALE!" sign with starburst graphics, red and white streamers. Young man nearby with a delighted expression. The red Cherry Coke branding pops vibrantly against the pastel mall background. Fun, nostalgic, a small joy in the day.

**Character note**: MC delighted by the sale display. Cherry Coke is his comfort item throughout the game — finding it on sale is a genuine small happiness. The display should be eye-catching and 90s promotional.

**Mood/palette**: Harsh Noon (mall fluorescent, vivid Cherry Coke red against pastels)

**Items visible**: Cherry Coke can pyramid, cardboard standee, "SALE!" sign, streamers

---

#### Scene 080: `event_ray_deal_handoff.png`

**Image prompt**: Downtown back alley, night, medium shot. Two figures — wiry man in leather jacket and young man with dark hair — doing a discreet exchange. One passes a brown-paper-wrapped package, the other passes a cash envelope. Both looking around nervously over their shoulders. Dumpster, fire escape, brick walls. Single bare bulb above a back door provides the only light. Deep noir atmosphere, claustrophobic framing. Shadows swallow everything the bulb does not touch.

**Character note**: Ray and MC in the handoff. Both nervous — looking around, not at each other. The wrapped package and cash envelope are the focal objects. The bare bulb light pool is tiny — they are barely illuminated.

**Mood/palette**: Moody Night (deep noir, single bare bulb, claustrophobic)

**Items visible**: Brown-paper package, cash envelope, bare lightbulb, dumpster, fire escape, brick walls

---

### Category 11: Special/Story Scenes (11 scenes)

---

#### Scene 081: `special_title_screen.png`

**Image prompt**: Stylized cityscape at dawn or dusk. Silhouetted skyscrapers of varying heights against a gradient sky — deep purple at top transitioning through magenta to warm orange at the horizon. A single small figure (MC) silhouetted on a rooftop or street corner, looking up at the towering city. "JUST A MAN" in bold pixel font, slightly glowing with warm light, positioned in upper portion. Clear space in lower third for menu options. Iconic, cinematic, sets the tone for the entire game.

**Character note**: MC as tiny silhouette only — identity conveyed by posture (looking up at the city) and signature sunglasses outline visible even in silhouette.

**Mood/palette**: Neon Nightlife + Warm Morning (purple-to-orange gradient, silhouette, dawn/dusk)

**Items visible**: City skyline (silhouette), MC figure (silhouette), title text space, menu space

---

#### Scene 082: `special_day1_wakeup.png`

**Image prompt**: Starter apartment, unusual low angle shot from mattress level on the floor. MC just waking up — one hand reaching toward a cheap alarm clock on the floor showing 7:00 AM in red LED digits. Harsh morning light blasting through bent blinds, light rays visible cutting across the room hitting his face. Floor-level perspective emphasizes the low starting point — we are literally looking up from nothing. Gritty, muted, slightly depressing. A new start from the very bottom.

**Character note**: MC waking up, seen from mattress level. Hand reaching for alarm clock. The low camera angle is unusual and intentional — we start as low as possible.

**Mood/palette**: Warm Morning (but gritty — harsh light, muted, ground level)

**Items visible**: Alarm clock (7:00 AM, red LED), mattress, bent blinds, light rays

---

#### Scene 083: `special_act1_to_act2.png`

**Image prompt**: Starter apartment, medium shot at the window. MC standing at the window at night, seen from behind as a silhouette against the glass. His posture is straighter than before — growing confidence visible in the set of his shoulders. City lights glitter beyond the dirty glass. Faint reflection of his face in the window. Deep blues dominate, warm amber city lights creating the sparkle. Contemplative, a turning point. Looking at the city thinking "I can do this."

**Character note**: MC silhouetted at window, seen from behind. Straighter posture than Day 1 scenes. The window reflection adds depth. This is the transition from surviving to building.

**Mood/palette**: Moody Night (deep blues, amber city lights, contemplative)

**Items visible**: Window (dirty glass), city lights beyond, MC's reflection (faint), window frame

---

#### Scene 084: `special_act2_to_act3.png`

**Image prompt**: Upgraded apartment or rooftop, medium shot. MC at a higher vantage point — the city skyline is now at eye level, not towering above. He holds a Cherry Coke casually. Better dressed than before (nicer jacket or shirt). Confidence in his stance — weight shifted, relaxed but alert. Rich vivid city lights spread across the background. More expansive, wider view than the Act 1 transition. Growth, ambition, the city becoming his peer instead of his master.

**Character note**: MC at eye level with the city. Cherry Coke in hand = staying grounded. Better clothes = progress. The composition should feel more expansive than Scene 083 — literally more room, more light, more possibility.

**Mood/palette**: Neon Nightlife + Warm (vivid city lights, confidence, expansion)

**Items visible**: Cherry Coke can, city skyline (at eye level), nicer clothing on MC

---

#### Scene 085: `special_gameover_bankrupt.png`

**Image prompt**: Starter apartment, but emptier than it has ever been — the boombox is gone, the CRT is gone, personal items stripped away. Only the bare mattress and the eviction notice taped to the open door remain. A single cardboard box on the floor — everything that is left. MC standing in the middle of the empty room, shoulders slumped, head down. Harsh cold light from the bare bulb. Completely desaturated palette — grey, cold blue, no warmth anywhere. The room that was never much now has nothing at all.

**Character note**: MC defeated — slumped posture, head down. The emptiness of the room tells the story. The eviction notice on the door is the narrative detail. The cardboard box = a life reduced to one container.

**Mood/palette**: Desaturated/Drained (cold bare bulb, grey, empty, no warmth)

**Items visible**: Eviction notice (on door), cardboard box, bare mattress, bare bulb, empty room

---

#### Scene 086: `special_gameover_burnout.png`

**Image prompt**: Hospital room. MC in a hospital bed, pale and exhausted, IV drip connected to his arm. Heart monitor beside the bed with a green line visualization (beep implied). Window shows the city skyline — indifferent, still moving, not caring. Get well cards on the nightstand. A Cherry Coke can also on the nightstand — the only warm color in the entire scene. Clinical whites, sterile blues, institutional green. The body gave out before the dream did.

**Character note**: MC in hospital bed — the grind broke him. Pale, exhausted, defeated by stress. The city through the window is indifferent — it does not care. The Cherry Coke on nightstand is the only warm personal touch in the sterile room.

**Mood/palette**: Desaturated/Drained (clinical white, sterile blue, one red accent: Cherry Coke)

**Items visible**: Hospital bed, IV drip, heart monitor (green line), get well cards, Cherry Coke can (nightstand), city through window

---

#### Scene 087: `special_win_ending.png`

**Image prompt**: Rooftop at sunrise, wide panoramic shot. MC and Diana (reddish hair, headphones around neck) standing at a rooftop railing, her head on his shoulder, looking out at the city. The entire city skyline spread below them bathed in spectacular sunrise light. Birds in the distance as small dark pixel V-shapes. They are small silhouettes against the vast, hopeful sky. Full sunrise color palette — deep violet at top, transitioning through pinks, oranges, and brilliant golds at the horizon. Everything earned, everything golden. This is what it was all for.

**Character note**: MC and Diana together — small against the sunrise but together. Her headphones catch the light (callback to earlier scenes). Birds in distance = freedom. The panoramic width should make this feel like the biggest scene in the game.

**Mood/palette**: Warm Morning at absolute maximum (full sunrise spectrum, golden triumph)

**Items visible**: Rooftop railing, city skyline (bathed in gold), sunrise, birds, Diana's headphones (catching light)

---

#### Scene 088: `special_credits_bg.png`

**Image prompt**: Montage-style background composition. Multiple small Polaroid-style photograph frames scattered on a warm textured surface (cork board or wooden table). Each Polaroid shows a tiny vignette from the game journey: the apartment, the park, the cafe, the pawn shop counter, the brokerage floor, the nightclub. Warm nostalgic golden overlay on everything. Handwritten marker captions under some Polaroids. A scrapbook of a life lived and hustled. Credits will scroll over this.

**Character note**: No large characters — tiny scenes inside Polaroid frames only. The composition should feel personal, like someone arranged their memories on a table.

**Mood/palette**: Warm Morning (golden nostalgic overlay, scrapbook warmth)

**Items visible**: Polaroid photographs (multiple, showing game locations), warm surface (cork/wood), marker captions

---

#### Scene 089: `special_narrator_intro.png`

**Image prompt**: Black background — pure darkness. Single warm amber spotlight illuminating an old leather armchair, slightly worn, in center frame. Small side table next to it with a whiskey glass (amber liquid, ice). Vintage standing microphone on a short stand nearby. No person is sitting in the chair — just the implied presence of someone who was or will be there. Warm amber spotlight against absolute black. Theatrical, mysterious, the voice of the game lives here.

**Character note**: NO characters visible. The empty chair implies the narrator. The whiskey glass, microphone, and chair are the only objects in a void of black. This is about atmosphere and voice, not a person.

**Mood/palette**: Moody Night (single amber spotlight in pure black, theatrical)

**Items visible**: Leather armchair (worn), whiskey glass, vintage microphone, spotlight

---

#### Scene 090: `special_montage_hustling.png`

**Image prompt**: Split-panel montage layout, divided into 4 quadrants like a comic book page. Top-left: hands digging through secondhand bin at the mall (fluorescent light). Top-right: hands placing item on pawn shop counter with Vinnie examining (warm amber). Bottom-left: CRT monitor with green stock numbers, hand on phone (green glow). Bottom-right: hands counting cash bills at home desk with calculator (warm desk lamp). Each quadrant has its own lighting and palette. Thin dark borders separating panels. The grind visualized as a cycle: buy, sell, trade, count.

**Character note**: Only MC's hands visible in each panel — no full figures. Each panel is a different moment in the hustle cycle. The variety of lighting across panels shows the different worlds the MC moves through.

**Mood/palette**: Mixed (each quadrant has own palette: fluorescent/amber/green glow/desk lamp)

**Items visible**: Secondhand bin items, pawn shop counter, CRT with stocks, cash bills and calculator

---

#### Scene 091: `event_newspaper_headline.png`

*Note: This scene is referenced in the plan but not yet in scenes.js. Include for completeness.*

**Image prompt**: Close-up of a 1990s newspaper front page, slightly angled. Bold black headline text in a template-ready area (large clear space for runtime text). Grainy black-and-white photo below the headline. MC's hands visible holding the edges of the newspaper from behind. Coffee cup at the bottom edge of frame. Morning sunlight coming from behind the paper, making it slightly translucent at edges. Newsprint off-white paper color, bold black ink, retro journalism layout with column lines.

**Character note**: MC's hands only — holding newspaper. The headline text area should be clearly templated for dynamic content. The grainy photo area is also templatable.

**Mood/palette**: Warm Morning (morning light behind paper, newsprint tones)

**Items visible**: Newspaper (with headline space), coffee cup, MC's hands

---

### Category 12: UI/Transition Scenes (8 scenes)

---

#### Scene 092: `location_pawnshop_exterior.png`

**Image prompt**: Exterior storefront view of a narrow pawn shop squeezed between larger buildings on a city street. Neon "PAWN" sign mounted above the door, slightly flickering (pixel animation suggested by uneven glow). Iron security bars on the display windows, items faintly visible behind glass (jewelry, electronics). "OPEN" sign hanging on the door. Red fire hydrant and blue newspaper dispenser box on sidewalk in front. Daytime, slightly overcast. The shop that started everything.

**Character note**: No characters. This is a location transition/establishing shot.

**Mood/palette**: Harsh Noon (overcast daylight, neon sign glow, iron bars)

**Items visible**: Neon "PAWN" sign, iron bars, window display, "OPEN" sign, fire hydrant, newspaper box

---

#### Scene 093: `location_nightclub_exterior.png`

**Image prompt**: Exterior nightclub entrance at night. Neon sign reading "CLUB NEON" (or "TONY'S") in flowing neon script above the door, glowing electric blue and pink. Velvet rope line leading to the entrance. Large bouncer silhouette at the door. Short line of people waiting, dressed for nightlife. Wet pavement reflecting the neon sign in colorful streaks. The entrance is a beacon of color in the dark street. You want to be inside.

**Character note**: No main characters. Bouncer as silhouette, line-waiters as small figures.

**Mood/palette**: Neon Nightlife (neon sign reflected on wet pavement, dark street)

**Items visible**: Neon "CLUB NEON" sign, velvet rope, bouncer silhouette, line of people, wet pavement reflections

---

#### Scene 094: `location_brokerage_exterior.png`

**Image prompt**: Exterior of a downtown office building, daytime. Glass-and-steel facade reflecting clouds. Polished brass nameplate reading "BULL & BEAR BROKERAGE" at entrance level. People in suits entering and exiting through revolving door. Electronic stock ticker visible scrolling through the lobby window from outside. Sharp, corporate, intimidating. Steel grey building, glass blue reflections, brass gold accents. A different world from the pawn shop.

**Character note**: No main characters. Suited businesspeople as background figures.

**Mood/palette**: Harsh Noon (sharp daylight, steel and glass, corporate)

**Items visible**: Brass "BULL & BEAR" nameplate, revolving door, stock ticker in lobby window, suited people

---

#### Scene 095: `ui_subway_map.png`

*Note: Referenced in the plan but not in scenes.js. Include for UI completeness.*

**Image prompt**: Stylized subway/transit map viewed from above, as if unfolded on a surface. Colored lines (red, blue, green, orange, yellow) connecting station dots that represent game locations. Each station dot is labeled with a location name. The map paper has a worn, folded texture with coffee stain rings. Station dots glow slightly when they are available. Bold colored lines, clean sans-serif location names. Retro transit map aesthetic.

**Character note**: No characters. This is a UI element.

**Mood/palette**: Special (worn paper texture, bold transit colors, coffee stains)

**Items visible**: Station dots (game locations), colored transit lines, worn paper, coffee stains

---

#### Scene 096: `ui_inventory_panel.png`

*Note: Referenced in the plan but not in scenes.js. Include for UI completeness.*

**Image prompt**: Top-down view inside an open backpack or dresser drawer. Divided into a visible grid of rectangular sections for item placement. Worn denim fabric or aged wood texture as the base. A wallet tucked in one corner. A keyring on a small hook. Grid spaces are clearly delineated for items to fill. Denim blue or wood brown tones. Functional, personal, organized chaos.

**Character note**: No characters. UI inventory screen.

**Mood/palette**: Special (denim blue or wood brown, personal, functional)

**Items visible**: Wallet, keyring, empty grid spaces, fabric/wood texture

---

#### Scene 097: `ui_stock_portfolio.png`

*Note: Referenced in the plan but not in scenes.js. Include for UI completeness.*

**Image prompt**: Close-up of a CRT monitor screen displaying a stock trading interface. Green monospace text on pure black background. Stock ticker symbols in a column with prices, change amounts in green (up) and red (down), and percentage changes. Blinking cursor at bottom. Visible scanlines across the screen. Beige plastic CRT monitor frame visible around the edges. Phosphor green glow bleeds slightly around bright text. Authentic early-90s terminal aesthetic.

**Character note**: No characters. UI stock screen.

**Mood/palette**: Special (phosphor green on black, CRT scanlines, beige frame)

**Items visible**: Stock tickers, prices (green/red), CRT frame, scanlines, cursor

---

#### Scene 098: `special_epilogue_slideshow.png`

*Note: Referenced in the plan but not in scenes.js. Include for completeness.*

**Image prompt**: Close-up of a single Polaroid photograph lying on a warm wooden table, illuminated by a nearby lamp. The photo shows a happy scene (template-ready — could be filled with any ending-specific content). Handwritten caption in black marker below the photo image. Other Polaroid edges peek in from the sides and corners of the frame, partially visible. Warm, nostalgic, deeply personal. Golden lamp light on everything. This is a memory worth keeping.

**Character note**: No direct characters. Template Polaroid content. The warmth and personal touch matter more than specific content.

**Mood/palette**: Warm Morning (golden lamp light, wood grain, nostalgic)

**Items visible**: Polaroid photograph (template), wooden table, lamp light, marker caption, other Polaroid edges

---

## ITEM SPRITES

All item sprites should be rendered as individual pixel art icons on a transparent background. Style should match the game aesthetic — limited palette, no anti-aliasing, clear silhouette at small size.

### Inventory Items (32x32 pixels)

| Item | Sprite Description |
|---|---|
| `casio_watch.png` | Small digital watch with rectangular face, metal band, LCD display showing time. Silver/grey metal, green-tinted LCD screen. |
| `busted_walkman.png` | Portable cassette player, slightly beat up. Grey/blue body with visible cassette window, orange foam headphones attached. Crack or tape on the body. |
| `leather_jacket.png` | Black leather jacket, folded or hanging. Zippered front, collar popped. Pixel shine highlights on the leather to suggest material. |
| `vhs_collection.png` | Small stack of 3-4 VHS tapes, slightly messy pile. Colorful spine labels visible. Black plastic cassette bodies. |
| `boombox.png` | Large portable stereo/boombox. Silver/black body, dual speakers, cassette deck, antenna. Red LED power indicator. Pixel musical note floating above. |
| `gold_chain.png` | Thick gold necklace chain, coiled in a loose circle. Bright gold color with pixel highlights to suggest shine and links. |
| `baseball_cards.png` | Small stack of baseball trading cards, fanned slightly to show different card faces. Colorful borders, tiny player figures visible. Held by a rubber band. |
| `typewriter.png` | Portable manual typewriter, slightly angled. Dark grey/green body, round keys, paper loaded with a few typed lines. Vintage feel. |
| `guitar.png` | Acoustic guitar, leaning at an angle. Warm brown wood body, black fretboard, steel strings catching light. Classic shape silhouette. |
| `polaroid_camera.png` | Polaroid instant camera. White/rainbow stripe body, large lens, flash bar on top. A tiny photo ejecting from the bottom slot. |
| `air_jordans.png` | Pair of high-top sneakers (Air Jordan style). Red, black, and white color scheme. Untied laces. The 90s status symbol. |
| `record_player.png` | Portable turntable/record player. Open lid, visible platter with vinyl record on it. Tonearm to the side. Brown/black body. Vintage portable style. |
| `comic_books.png` | Small stack of comic books, slightly fanned. Colorful covers with tiny superhero figures visible. Bold title text on covers. Slightly worn corners. |
| `denim_jacket.png` | Blue denim jacket, folded or hanging. Classic medium blue wash, visible buttons, collar. Maybe a small pin or patch for character. |
| `radio.png` | Small portable AM/FM transistor radio. Rectangular, dark body, silver antenna extended, speaker grille, dial knob. Simple, utilitarian. |
| `roller_blades.png` | Pair of inline roller blades/skates. Black boots with neon-colored wheels (green or pink). Buckle straps. Peak 90s recreation. |
| `flannel_shirt.png` | Flannel button-down shirt, folded. Red and black plaid pattern rendered in pixel grid. Slightly wrinkled. Grunge era staple. |
| `vhs_player.png` | VHS VCR unit. Long black rectangular box with slot on front, LED clock display (blinking 12:00), buttons. Silver trim. |
| `board_game.png` | Board game box, slightly angled to show colorful cover art. Generic fun artwork with dice and game piece imagery. "FUN" energy without being a specific brand. |
| `sunglasses.png` | Dark aviator-style or wayfarer sunglasses, folded or unfolded. Black frames, dark tinted lenses with pixel reflection highlight. MC's signature item. |
| `mixtape.png` | Audio cassette tape. Clear or colored shell with visible tape reels. Hand-written label on the front in pen. Maybe a small heart or track listing. Personal, nostalgic. |

### Gift Items (32x32 pixels)

| Item | Sprite Description |
|---|---|
| `whiskey_bottle.png` | Whiskey bottle, amber liquid, black label, cork or cap. Short squat bottle shape. Warm amber glass color with label detail. |
| `cherry_coke_can.png` | Cherry Coke soda can. Bright red with "Cherry Coke" branding in white/maroon. The iconic can — condensation droplets as pixel highlights. |
| `jazz_cd.png` | CD in jewel case, slightly angled to show rainbow refraction on disc surface. "JAZZ" or saxophone artwork on the insert cover. Jewel case clear plastic frame. |
| `flowers.png` | Small bouquet of flowers wrapped in paper. Mixed colors — red, yellow, pink, purple blooms. Green stems, white wrapping paper with ribbon. Simple, romantic. |
| `cigar.png` | Single cigar, brown wrapper with band/ring near one end. Slight curve. Rich brown tones. Maybe a wisp of pixel smoke from the tip if unlit. |
| `leather_gloves.png` | Pair of leather driving gloves, folded or paired. Dark brown or black leather. Visible stitching detail. Classy accessory. |
| `tea_set.png` | Small teapot and cup on a tiny tray. White/blue porcelain with delicate pattern. Steam pixels rising from spout. Elegant, refined. |
| `champagne_bottle.png` | Champagne bottle, dark green glass, gold foil on neck, label. Slightly tilted. Maybe tiny sparkle pixels at the top suggesting effervescence. Celebration in a bottle. |

### Special Items (32x32 pixels, except Ring Box at 64x64)

| Item | Sprite Description |
|---|---|
| `pager.png` | 90s pager/beeper. Small black rectangular device with tiny LCD screen showing a number. Belt clip on back. The device that meant someone needed you. |
| `ring_box.png` (64x64) | Small velvet ring box, either closed (dark blue/black velvet, cube shape) or open (revealing a sparkling ring inside with prominent pixel sparkle). Render BOTH states as separate sprites: `ring_box_closed.png` and `ring_box_open.png`. |
| `wallet.png` | Brown leather bifold wallet, slightly open showing edge of bills and a card. Worn leather texture. Personal, everyday. |
| `cash_envelope.png` | White or manila envelope, slightly bulging, with green bills peeking from the unsealed top. Suggests significant cash. |
| `newspaper.png` | Folded newspaper, front page visible. Black headline text (small/illegible at icon size), columns, grey photo area. Slightly yellowed newsprint color. |

### UI Icons (32x32 pixels)

| Icon | Sprite Description |
|---|---|
| `icon_cash.png` | Green dollar sign ($) or small stack of green bills. Bold, immediately readable as "money" at small size. Green with dark outline. |
| `icon_reputation.png` | Gold five-pointed star, bold outline, filled with warm gold. Slight pixel sparkle at top point. Reads as "status" or "fame." |
| `icon_charm.png` | Red/pink heart shape, classic pixel heart (like Zelda). Bold, filled, slight highlight on upper left. Reads as "charm" or "love." |
| `icon_stress.png` | Yellow lightning bolt, jagged, bold outline. Electric yellow with white core highlight. Reads as "stress" or "tension" or "energy." |

---

## CONSISTENCY NOTES

1. **MC appearance must stay consistent** across all 90+ scenes. Use the first rendered MC scene as the reference anchor for all subsequent scenes.
2. **NPC designs lock after first image.** Once Vinnie, Diana, Marcus, Ray, Mrs. Chen, or Tony are rendered, use that result as reference for all their subsequent scenes.
3. **Scenes 045 (`diana_win_ending`) and 087 (`special_win_ending`) share composition** — rooftop sunrise with Diana — at different framings (medium vs. wide panoramic). Render them as a pair.
4. **Template scenes** (091 newspaper, 098 Polaroid) have text/image areas that will be filled dynamically at runtime. Leave clear template-ready spaces.
5. **Cherry Coke red** (#CC0000 range) should be a consistent recognizable accent color throughout the game wherever the can appears.
6. **Scene lighting drives the story.** Warm = safety/love/success. Cold = danger/loneliness/failure. Neon = excitement/nightlife/risk. Desaturated = defeat/loss/betrayal. Maintain this emotional language consistently.

## IMAGE GENERATION ORDER (Recommended)

1. **Title screen** (081) — establishes the visual tone and city style
2. **Home starter variants** (001-003) — locks the interior style and MC apartment design
3. **One NPC each** (032 Vinnie, 037 Diana, 046 Marcus, 051 Ray, 057 Chen, 061 Tony) — locks all six character designs
4. **Remaining location backgrounds** (004-025, 026-031 casino) — builds the world
5. **Remaining NPC scenes** — uses locked character designs
6. **Activity and event scenes** — combines established locations with MC
7. **Special/story scenes** — uses all established assets
8. **UI screens and item sprites** — last, as they are most independent
