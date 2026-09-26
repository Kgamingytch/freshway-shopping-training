// Central custom-emoji registry - every emoji the bot uses must come from
// here so unicode emojis never leak into FreshWay messages.
//
// Custom emoji syntax: <:name:id> (animated: <a:name:id>).

const E = {
  // brand / general
  freshway: "<:freshway:1520477652840874004>",
  announcement: "<:announcement:1520666633633534112>",
  arrow: "<:arrow:1529399913194979458>",
  forward: "<:forward:1550196783420801125>",
  bookmarkflag: "<:bookmarkflag:1553089161538576394>",
  boost: "<:boost:1521023726416822292>",
  dot: "<:dot:1528720605950771281>",
  discord: "<:discord:1520461795389607936>",
  tiktok: "<:tiktok:1537343536372908092>",
  roblox: "<:roblox:1520461861466931312>",
  home: "<:home:1520461904932372561>",

  // status / feedback
  check: "<:check:1520451956294811840>",
  cross: "<:cross1:1520461159843496068>",
  warning: "<:warning:1520662830234210304>",
  warning1: "<:warning1:1525465317541941258>",
  question: "<:question1:1520495652109418526>",
  connected: "<:connected:1520663157192785971>",
  disconnected: "<:disconnected:1520688965261328474>",
  nosound: "<:nosound:1553089180614140108>",
  heart: "<:heart1:1520689219280834681>",

  // people / roles
  person: "<:person1:1520461920212353024>",
  people: "<:people:1520461886867509358>",
  member: "<:member:1553089134980108410>",
  personminus: "<:personminus:1553089177040457729>",
  security: "<:security_person:1553089131339456603>",
  handshake: "<:handshake1:1520497131482251274>",
  support: "<:support:1520674742003306516>",

  // time / schedule
  calendar: "<:calendar1:1521023707181482105>",
  schedule: "<:schedule:1553089153288372254>",
  time: "<:time:1550494647367766166>",
  history: "<:history:1553089165523034233>",

  // objects / tools
  bookmark: "<:bookmarkflag:1553089161538576394>",
  comment: "<:comment:1553089146074177666>",
  document: "<:document:1550197706289455215>",
  engineering: "<:engineering:1521028606568955904>",
  gavel: "<:gavel:1553089169360814171>",
  highlight: "<:highlight:1529400457938862140>",
  key: "<:key1:1526129915575930982>",
  link: "<:link1:1521039266925383790>",
  moderation: "<:moderation:1520498323121897634>",
  pencil: "<:pencil1:1526172929128267918>",
  pin: "<:pin:1528689465684525106>",
  rule: "<:rule:1553089139136663633>",
  tag: "<:tag:1553089157029568514>",
  training: "<:training:1525213820358758601>",
  unlock: "<:unlock:1553089173127303339>",
  vacancies: "<:vacancies:1520754619838627963>",
};

/** Parse "<:name:id>" into { name, id } for builders that want an object. */
function parse(emoji) {
  const m = /^<a?:(\w+):(\d+)>$/.exec(emoji);
  return m ? { name: m[1], id: m[2] } : undefined;
}

module.exports = E;
module.exports.parse = parse;
