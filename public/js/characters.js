/* 角色数据：暗流涌动（Trouble Brewing）+ 可自定义角色
   先用文字代替立绘，后续换成图片时只需给 tile 加上背景图。 */
(function (global) {
  'use strict';

  var TYPES = {
    townsfolk: { key: 'townsfolk', label: '镇民', short: '镇', color: '#7f9bd0', dim: 'rgba(127,155,208,.16)' },
    outsider: { key: 'outsider', label: '外来者', short: '外', color: '#7fae8a', dim: 'rgba(127,174,138,.16)' },
    minion: { key: 'minion', label: '爪牙', short: '爪', color: '#cf9252', dim: 'rgba(207,146,82,.16)' },
    demon: { key: 'demon', label: '恶魔', short: '恶', color: '#c4555f', dim: 'rgba(196,85,95,.16)' },
    custom: { key: 'custom', label: '其他', short: '他', color: '#8f8798', dim: 'rgba(143,135,152,.16)' }
  };

  var LIST = [
    { id: 'washerwoman', cn: '洗衣妇', en: 'Washerwoman', type: 'townsfolk', ability: '首个夜晚，你会得知两名玩家中有一位是某个特定的镇民。' },
    { id: 'librarian', cn: '图书管理员', en: 'Librarian', type: 'townsfolk', ability: '首个夜晚，你会得知两名玩家中有一位是某个特定的外来者，或得知本局没有外来者。' },
    { id: 'investigator', cn: '调查员', en: 'Investigator', type: 'townsfolk', ability: '首个夜晚，你会得知两名玩家中有一位是某个特定的爪牙。' },
    { id: 'chef', cn: '厨师', en: 'Chef', type: 'townsfolk', ability: '首个夜晚，你会得知场上有几对相邻的邪恶玩家。' },
    { id: 'empath', cn: '共情者', en: 'Empath', type: 'townsfolk', ability: '每个夜晚，你会得知你的两名存活邻居中有几名邪恶玩家。' },
    { id: 'fortune_teller', cn: '占卜师', en: 'Fortune Teller', type: 'townsfolk', ability: '每个夜晚，选择两名玩家，得知其中是否有恶魔。有一名玩家会被误认为恶魔。' },
    { id: 'undertaker', cn: '送葬者', en: 'Undertaker', type: 'townsfolk', ability: '每个夜晚，你会得知今天被处决的玩家的角色。' },
    { id: 'monk', cn: '修士', en: 'Monk', type: 'townsfolk', ability: '每个夜晚，选择一名玩家（不能是自己）；该玩家今晚不会死于恶魔之手。' },
    { id: 'ravenkeeper', cn: '守鸦人', en: 'Ravenkeeper', type: 'townsfolk', ability: '若你在夜晚死亡，你可以选择一名玩家并得知其角色。' },
    { id: 'virgin', cn: '处女', en: 'Virgin', type: 'townsfolk', ability: '你首次被提名时，若提名你的人是镇民，提名者立即被处决。' },
    { id: 'slayer', cn: '杀手', en: 'Slayer', type: 'townsfolk', ability: '白天时，你可以公开选择一名玩家；若他是恶魔，他死亡。' },
    { id: 'soldier', cn: '士兵', en: 'Soldier', type: 'townsfolk', ability: '恶魔无法在夜晚杀死你。' },
    { id: 'mayor', cn: '镇长', en: 'Mayor', type: 'townsfolk', ability: '若白天仅剩三名玩家存活且当天无人被处决，你方获胜。若你在夜晚被杀，可让另一名玩家代替你死亡。' },

    { id: 'butler', cn: '管家', en: 'Butler', type: 'outsider', ability: '每个夜晚，选择一名玩家（不能是自己）；明天只有他投票时你才能投票。' },
    { id: 'drunk', cn: '醉汉', en: 'Drunk', type: 'outsider', ability: '你自认为是某个镇民，但你实际上是醉汉。' },
    { id: 'recluse', cn: '隐士', en: 'Recluse', type: 'outsider', ability: '你可能会被侦测为邪恶或恶魔，即使你已经死亡。' },
    { id: 'saint', cn: '圣徒', en: 'Saint', type: 'outsider', ability: '若你被处决，你的阵营立即失败。' },

    { id: 'poisoner', cn: '中毒者', en: 'Poisoner', type: 'minion', ability: '每个夜晚，选择一名玩家；他今晚和明天白天中毒。' },
    { id: 'spy', cn: '间谍', en: 'Spy', type: 'minion', ability: '每个夜晚可以查看魔典。你可能被侦测为镇民或外来者，即使已经死亡。' },
    { id: 'scarlet_woman', cn: '红唇女郎', en: 'Scarlet Woman', type: 'minion', ability: '若恶魔死亡且你存活，并且当时有五名或更多玩家存活，你成为新的恶魔。' },
    { id: 'baron', cn: '男爵', en: 'Baron', type: 'minion', ability: '场上的外来者数量 +2。' },

    { id: 'imp', cn: '小恶魔', en: 'Imp', type: 'demon', ability: '每个夜晚，选择一名玩家杀死。若你在夜晚选择杀死自己，一名爪牙会变成恶魔。' }
  ];

  var BY_ID = {};
  LIST.forEach(function (c) { BY_ID[c.id] = c; });

  function info(id) {
    if (!id) return null;
    if (BY_ID[id]) return BY_ID[id];
    if (id.indexOf('custom:') === 0) {
      return { id: id, cn: id.slice(7), en: '自定义', type: 'custom', ability: '' };
    }
    return { id: id, cn: id, en: '', type: 'custom', ability: '' };
  }

  global.CHARACTERS = LIST;
  global.CHAR_TYPES = TYPES;
  global.charInfo = info;
})(window);
