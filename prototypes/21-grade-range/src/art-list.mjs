// The original artwork the prototype uses, with the prompt each image is
// generated from. Icons share one style sentence so the set looks like it
// belongs to the rabbit teacher's sunny garden world. New poses of the rabbit
// are drawn from its existing picture, so it stays the same character. The
// logo is a lockup with the name 好奇星球 drawn along the planet's orbit; its
// refinements and its text-free mark are drawn from it, so the look stays.

const ICON_STYLE =
  '3D animated feature-quality game icon with soft hand-painted texture and warm rim light, rounded chunky friendly shapes, ' +
  'gentle pastel palette of cream, carrot orange, leaf green, denim blue and apricot yellow, whimsical and cute for children, high production values. ' +
  'Single object only, centered, front three-quarter view, the object fills about 85 percent of the square image. ' +
  'No scene, no platform, no ground shadow, no text, no letters, no numbers, no border. True transparent background.';

const LOCKUP_STYLE =
  'Logo for a modern learning product for children and teenagers aged 3 to 18, whose Chinese name is exactly the four characters 好奇星球. ' +
  'The four characters 好奇星球 are written once, correctly and clearly, in a bold rounded modern sans-serif, dark navy (#1D2238), ' +
  'laid out to follow the tilt and curve of the planet and its orbit so text and planet form one dynamic, slightly tilted composition. ' +
  'Modern, clean, friendly and simple, flat vector style with gentle gradients only, no purple, no 3D texture, no drop shadow. ' +
  'The planet is the main element and the text is secondary. Readable when shown 40 pixels tall. ' +
  'No other text, no English letters, no slogan, no background shape. True transparent background.';

const KEEP_LOGO_G =
  'Keep the logo in the reference image: the same stylized Earth with blue oceans, green continents and small white clouds, the same thin light-blue orbit line ' +
  'with the small yellow moon, and the same four characters 好奇星球 rising along the orbit on the right side, in the same composition and tilt. ' +
  'Remove the face completely: no eyes, no mouth, no cheeks, no blush; the Earth shows only oceans, land and clouds. ' +
  'Make the four characters 好奇星球 a little larger and bolder so they read clearly when the logo is shown 40 pixels tall, written once and correctly. ' +
  'Flat vector style with gentle gradients, no purple, no drop shadow, no other text. True transparent background.';

const iconItem = (name, subject) => ({
  name,
  file: `icon-${name}.png`,
  size: '1024x1024',
  prompt: `${subject} ${ICON_STYLE}`,
});

const lockupItem = (name, subject) => ({
  name,
  file: `${name}.png`,
  size: '1536x1024',
  prompt: `${subject} ${LOCKUP_STYLE}`,
});

export const ART_LIST = [
  iconItem('home', 'A tiny cozy cottage with a round wooden door, a rounded thatched roof and a small carrot patch beside it.'),
  iconItem('settings', 'A friendly wooden cog wheel with a small green sprout growing from its top and a tiny brass bolt in the middle.'),
  iconItem('family', 'A small round heart-shaped house with a warm glowing window and a little chimney, as a symbol for a family home.'),
  iconItem('child', 'A small rounded school backpack in denim blue with an apricot-yellow flap and a tiny carrot keychain hanging from the zipper.'),
  iconItem('key', 'A chunky brass key whose bow is shaped like a carrot with green leaves.'),
  iconItem('globe', 'A small desk globe in soft blue and green on a wooden stand, with a tiny round alarm clock leaning against it.'),
  iconItem('letter', 'A plump cream envelope sealed with a round red heart-shaped wax seal, slightly tilted.'),
  iconItem('hourglass', 'A rounded wooden hourglass with soft green sand flowing from the top half to the bottom half.'),
  iconItem('crown', 'A small chunky golden crown with three rounded points, each topped with a tiny round gem.'),
  iconItem('door', 'A round-topped wooden garden door standing slightly open, with warm light coming through the gap.'),
  iconItem('search', 'A chunky magnifying glass with a wooden handle, looking at a tiny question-mark-shaped leaf.'),
  iconItem('wrench', 'A small open wooden toolbox with a rounded wrench and a roll of bandage tape sticking out.'),
  iconItem('party', 'A party popper bursting with soft round confetti and tiny carrot-shaped streamers.'),
  iconItem('seedling', 'A tiny sprout with two round leaves growing in a small terracotta pot.'),
  iconItem('consent', 'A rounded wooden clipboard holding a cream sheet of paper with a big green check mark.'),
  {
    name: 'rabbit-wave',
    file: 'rabbit-wave.png',
    size: '1024x1024',
    reference: 'art/rabbit.webp',
    prompt:
      'The same cream-white rabbit gardener character as in the reference image, identical face, ears, denim overalls and apricot-yellow neckerchief. ' +
      'Half-body portrait from the waist up, facing the viewer with the body turned slightly to the viewer\'s right, ' +
      'one paw raised in a friendly wave, a warm welcoming smile, eyes looking at the viewer. ' +
      'Both ear tips fully visible, the figure fills about 90 percent of the image height and is cut off at the waist by the bottom edge. ' +
      '3D animated feature-quality character with soft hand-painted texture and warm rim light, same rendering style as the reference. ' +
      'No scene, no platform, no shadows outside the silhouette, no other objects or text. True transparent background.',
  },
  lockupItem(
    'logo-g',
    'A friendly stylized Earth with blue oceans and soft green continents, tilted about 20 degrees, with one thin orbit line sweeping around it; ' +
      'the characters 好奇星球 sit along the curve of the orbit line on the right side, rising with it.',
  ),
  {
    name: 'logo-g1',
    file: 'logo-g1.png',
    size: '1536x1024',
    reference: 'art/logo-g.png',
    prompt: KEEP_LOGO_G,
  },
  {
    name: 'logo-mark',
    file: 'logo-mark.png',
    size: '1024x1024',
    reference: 'art/logo-g1.png',
    prompt:
      'The same logo as in the reference image, without the text: keep the same stylized Earth with blue oceans, green continents and small white clouds, ' +
      'the same thin light-blue orbit line and the small yellow moon, in the same tilt and the same flat style with gentle gradients. ' +
      'Remove the four characters completely and close the orbit line where they were. No text, no letters at all. ' +
      'Make the orbit slightly tighter so the whole mark is compact and fills about 90 percent of the square image, readable at 28 pixels. True transparent background.',
  },
];
