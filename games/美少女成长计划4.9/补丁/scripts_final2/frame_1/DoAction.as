_global.bridge = AS2_4399_API.Bridge.getInstance();
var _4399_function_ad_id = "92d6cef76cd06829e088932fe9fd819b";
版本号 = 4.97;
版本.text = "版本：" + 版本号;

var 点击测试 = _root.createTextField("点击测试", 20050, 10, 470, 300, 26);
点击测试.textColor = 16711680;
点击测试.text = "no event";
_root.onMouseMove = function() { 点击测试.text = "mv " + _root._xmouse + "," + _root._ymouse; };
_root.onMouseDown = function() { 点击测试.text = "DOWN " + _root._xmouse + "," + _root._ymouse; };
// ==================== 存档系统补丁 BEGIN ====================
// 为游戏补全本地存档/读档功能（基于 SharedObject）
var 存档_存储名 = "meishao49_local_save";
var 存档_变量表 = ["年龄","年","月","日","星期","日期属性","金钱","体力","腕力","智力","自尊","气质","叛逆","魅力","声望","亲和","感受","道德","信仰","魔性","罪孽","战斗技巧","战斗能力","战斗防御","魔法技巧","魔法能力","魔法防护","礼仪","谈吐","绘画","烹饪","魔法","家务","交际","声乐","舞蹈","文学","父亲关系","管家关系","王子关系","魔王关系","龙王关系","国王关系","王后关系","精灵关系","卫兵关系","男爵关系","伯爵关系","公爵关系","商人关系","家务工作","幼儿园工作","农场工作","工地工作","教堂工作","餐厅工作","仆人酒吧工作","憔夫工作","旅馆工作","市场工作","酒馆工作","魅情酒店工作","武器店工作","赌场工作","家庭教师工作","黑街工作","礼仪课","文学课","声乐课","绘画课","烹饪课","战斗课","魔法课","舞蹈课","神学课","疲劳","增","工资修正值","打死怪兽","与怪物接触次数","战斗失败次数","正","负","生病天数","龙接触","杀龙次数","与龙王的关系","与王子的关系","魔王子关系","教堂捐款数量","身高","体重","胸围","腰围","臀围","衣服","疲劳开关","服装开关","生病状态","皇宫次数","饮食参数","游戏速度","游戏状况","每月评价","每月谈话","吃饭","事件触发","工作升级了","工作等级","月工作1","月工作2","月工作3","记录当月状态参数","凶关系","恶关系","善关系","中关系","矮关系","龙关系","父亲名字","父亲的生日日期","父亲的血型","女儿的名字","女儿的生日日期","女儿血型","您血型","工地事件","酒馆事件","赌场事件","仆人酒店事件","市场事件","武器店事件","家庭教师事件","龙王子事件","人类王子事件","矮人事件","修道服事件","国王的新衣事件","黑街事件","神甫事件","白马事件","王子的事件","魔性事件","歌手事件","金钱事件","金钱事件2","妈妈的事件","爸爸的事件","管家的事件","生病的事件","不良服事件","送衣服事件","富豪宴请事件","富豪约会事件","母女团聚事件","刷牙事件","王子跳舞事件","魅力衣服事件","路见不平事件","龙王约会事件","夸奖勤快义工事件","许愿事件","见精灵事件","征风吃醋事件","占卜师事件","出门事件","魔性三十事件","好朋友","好孩子"];
var 存档_数组表 = ["所有衣服", "商店的衣服"];

function 存档_读数据(槽位)
{
   var so = SharedObject.getLocal(存档_存储名);
   return so.data["槽位" + 槽位];
}

function 存档_有数据(槽位)
{
   var d = 存档_读数据(槽位);
   return d != undefined && d != null;
}

function 存档_取时间()
{
   var d = new Date();
   var 分 = d.getMinutes();
   var 分文本 = 分 < 10 ? "0" + 分 : "" + 分;
   return d.getFullYear() + "/" + (d.getMonth() + 1) + "/" + d.getDate() + " " + d.getHours() + ":" + 分文本;
}

function 存档_标题文本()
{
   return "" + _root.女儿的名字 + "  " + _root.年龄 + "y " + _root.年 + "/" + _root.月 + "/" + _root.日;
}

function 存档_生成()
{
   var d = new Object();
   var i;
   var n;
   var v;
   for (i = 0; i < 存档_变量表.length; i++)
   {
      n = 存档_变量表[i];
      v = _root[n];
      if (v != undefined && (typeof(v) == "number" || typeof(v) == "string" || typeof(v) == "boolean"))
      {
         d[n] = v;
      }
   }
   for (var k in _root)
   {
      if (k.substr(0, 1) == "_" || k.substr(0, 1) == "$" || k.substr(0, 3) == "存档_")
      {
         continue;
      }
      var v2 = _root[k];
      var t2 = typeof(v2);
      if ((t2 == "number" || t2 == "string" || t2 == "boolean") && d[k] == undefined)
      {
         d[k] = v2;
      }
   }
   for (i = 0; i < 存档_数组表.length; i++)
   {
      n = 存档_数组表[i];
      v = _root[n];
      if (v != undefined && typeof(v) == "object")
      {
         var 副本 = Array();
         var j2 = 0;
         while(j2 < v.length)
         {
            副本.push(v[j2]);
            j2++;
         }
         d[n] = 副本;
      }
   }
   d.__标题 = 存档_标题文本();
   d.__时间 = 存档_取时间();
   return d;
}

function 存档_写入(槽位)
{
   var so = SharedObject.getLocal(存档_存储名);
   so.data["槽位" + 槽位] = 存档_生成();
   so.data.最后槽位 = 槽位;
   so.flush();
}

function 存档_隐藏提示()
{
   if (_root.存档提示文本 != undefined)
   {
      _root.存档提示文本._visible = false;
      _root.存档提示文本.text = "";
   }
   if (_root.存档提示关闭 != undefined)
   {
      _root.存档提示关闭._visible = false;
   }
}
function 存档_反馈(文本)
{
   if (_root.存档提示文本 == undefined)
   {
      _root.存档提示文本 = _root.createTextField("存档提示文本", 20011, 90, 398, 460, 66);
      var 反馈格式 = new TextFormat();
      反馈格式.font = "FZCuQian-M17S";
      反馈格式.size = 13;
      _root.存档提示文本.setNewTextFormat(反馈格式);
      _root.存档提示文本.border = true;
      _root.存档提示文本.background = true;
      _root.存档提示文本.backgroundColor = 16777215;
      _root.存档提示文本.textColor = 16711680;
      _root.存档提示文本.multiline = true;
      _root.存档提示文本.wordWrap = true;
      _root.存档提示文本.selectable = false;
      _root.存档提示文本._visible = false;
   }
   if (_root.存档提示关闭 == undefined)
   {
      _root.存档提示关闭 = _root.attachMovie("工作名称", "存档提示关闭", 20012, {_x:440, _y:402});
      _root.存档提示关闭.岗位.text = "X close";
      _root.存档提示关闭.onRelease = function()
      {
         _root.存档_隐藏提示();
      };
      _root.存档提示关闭._visible = false;
   }
   _root.存档提示文本.text = 文本;
   _root.存档提示文本._visible = true;
   _root.存档提示关闭._visible = true;
   if (_root.存档_提示计时器 != undefined)
   {
      clearInterval(_root.存档_提示计时器);
   }
   _root.存档_提示计时器 = setInterval(function ()
   {
      clearInterval(_root.存档_提示计时器);
      _root.存档_隐藏提示();
   }, 2000);
}

function 存档_应用(d)
{
   for (var k in d)
   {
      if (k.substr(0, 2) == "__")
      {
         continue;
      }
      _root[k] = d[k];
   }
   if (typeof(_root.游戏时间) == "function")
   {
      _root.游戏时间();
   }
   if (_root.主面板 != undefined && typeof(_root.主面板.更新) == "function")
   {
      _root.主面板.更新();
   }
   if (typeof(_root.身材函数) == "function")
   {
      _root.身材函数();
   }
   if (typeof(_root.更新数值) == "function")
   {
      _root.更新数值();
   }
   if (typeof(_root.说话情况) == "function")
   {
      _root.说话情况();
   }
   // 恢复人物外观：年龄阶段 + 当前衣服 + 季节背景
   if (_root.女儿人物 != undefined && _root.女儿人物.人 != undefined && _root.衣服 != undefined)
   {
      if (_root.年 >= 1768)
      {
         _root.女儿人物.gotoAndStop(3);
      }
      else if (_root.年 >= 1766)
      {
         _root.女儿人物.gotoAndStop(2);
      }
      else
      {
         _root.女儿人物.gotoAndStop(1);
      }
      _root.女儿人物.人.gotoAndStop(_root.衣服);
   }
   if (_root.背景1 != undefined)
   {
      if (_root.月 <= 3)
      {
         _root.背景1.gotoAndStop(1);
      }
      else if (_root.月 <= 6)
      {
         _root.背景1.gotoAndStop(2);
      }
      else if (_root.月 <= 9)
      {
         _root.背景1.gotoAndStop(3);
      }
      else
      {
         _root.背景1.gotoAndStop(4);
      }
   }
}

function 执行读档(槽位)
{
   var d = 存档_读数据(槽位);
   if (d == undefined || d == null)
   {
      存档_反馈("slot" + 槽位 + " 没有存档 no data");
      return;
   }
   _root.存档_待应用数据 = d;
   if (_root.系统设置 != undefined)
   {
      _root.系统设置.removeMovieClip();
   }
   if (_root.存档提示文本 != undefined)
   {
      _root.存档提示文本.text = "";
   }
   _root.gotoAndStop(11);
   存档_等待应用();
}

function 存档_等待应用()
{
   var 次数 = 0;
   var 检查 = function ()
   {
      次数++;
      if (_root._currentframe == 11 && typeof(_root.更新数值) == "function")
      {
         clearInterval(_root.存档_应用轮询);
         存档_应用(_root.存档_待应用数据);
         存档_反馈("读档成功 load ok  welcome back: " + _root.女儿的名字);
      }
      else if (次数 > 60)
      {
         clearInterval(_root.存档_应用轮询);
      }
   };
   _root.存档_应用轮询 = setInterval(检查, 100);
}

function 刷新槽位标题(面板)
{
   var i;
   for (i = 1; i <= 3; i++)
   {
      var tf = 面板["槽位标题" + i];
      if (tf == undefined)
      {
         tf = 面板.createTextField("槽位标题" + i, 500 + i, 230, 64 + (i - 1) * 72, 140, 40);
         var 标题格式 = new TextFormat();
         标题格式.font = "FZCuQian-M17S";
         标题格式.size = 12;
         tf.setNewTextFormat(标题格式);
         tf.textColor = 3355443;
         tf.multiline = true;
         tf.wordWrap = true;
      }
      var d = 存档_读数据(i);
      if (d == undefined || d == null)
      {
         tf.text = "empty 空档位";
      }
      else
      {
         tf.text = d.__标题 + "\n" + d.__时间;
      }
   }
}

function 延迟刷新标题()
{
   var 次数 = 0;
   var 检查 = function ()
   {
      次数++;
      var 面板 = _root.系统设置;
      if (面板 != undefined && (面板._currentframe == 3 || 面板._currentframe == 4))
      {
         clearInterval(_root.存档_标题轮询);
         刷新槽位标题(面板);
      }
      else if (次数 > 40)
      {
         clearInterval(_root.存档_标题轮询);
      }
   };
   _root.存档_标题轮询 = setInterval(检查, 150);
}

function 处理槽位点击()
{
   var 面板 = _root.系统设置;
   if (面板 == undefined)
   {
      return;
   }
   var 局部y = _root._ymouse - 面板._y;
   var 槽位 = 3;
   if (局部y < 121)
   {
      槽位 = 1;
   }
   else if (局部y < 194)
   {
      槽位 = 2;
   }
   if (_root.年 == undefined && 面板._currentframe != 4)
   {
      存档_反馈("先开始游戏后才能存档 start a game first");
      return;
   }
   if (面板._currentframe == 4)
   {
      执行读档(槽位);
   }
   else
   {
      存档_写入(槽位);
      存档_反馈("存档成功 save ok  slot" + 槽位 + ":" + 存档_标题文本());
      刷新槽位标题(面板);
   }
}

function 首页删读档面板()
{
   if (_root.首页读档面板 != undefined)
   {
      _root.首页读档面板.removeMovieClip();
   }
}
function 首页建读档面板(槽位列表)
{
   首页删读档面板();
   var p = _root.createEmptyMovieClip("首页读档面板", 20030);
   p.beginFill(0, 40);
   p.moveTo(0, 0);
   p.lineTo(640, 0);
   p.lineTo(640, 480);
   p.lineTo(0, 480);
   p.lineTo(0, 0);
   p.endFill();
   p.onRelease = function()
   {
   };
   var 底高 = 96 + 槽位列表.length * 44 + 50;
   var 顶 = int((480 - 底高) / 2);
   p.beginFill(16773599, 100);
   p.moveTo(150, 顶);
   p.lineTo(490, 顶);
   p.lineTo(490, 顶 + 底高);
   p.lineTo(150, 顶 + 底高);
   p.lineTo(150, 顶);
   p.endFill();
   p.lineStyle(2, 10053171, 100);
   p.moveTo(150, 顶);
   p.lineTo(490, 顶);
   p.lineTo(490, 顶 + 底高);
   p.lineTo(150, 顶 + 底高);
   p.lineTo(150, 顶);
   var 面板格式 = new TextFormat();
   面板格式.font = "FZCuQian-M17S";
   面板格式.size = 14;
   var 标题框 = p.createTextField("面板标题", 1, 162, 顶 + 10, 316, 26);
   标题框.setNewTextFormat(面板格式);
   标题框.textColor = 16711680;
   标题框.selectable = false;
   标题框.text = "select a save to load 选择要读取的记忆:";
   var k = 0;
   var i = 0;
   while(i < 槽位列表.length)
   {
      k++;
      var 槽 = 槽位列表[i];
      var 按钮 = p.attachMovie("工作名称", "槽" + 槽, 10 + k, {_x:162, _y:顶 + 44 + (k - 1) * 42});
      按钮.槽位号 = 槽;
      按钮.onRelease = function()
      {
         var s = this.槽位号;
         _root.首页删读档面板();
         _root.执行读档(s);
      };
      var d = 存档_读数据(槽);
      按钮.岗位.text = "slot " + 槽 + ":  " + d.__标题 + "  " + d.__时间;
      i++;
   }
   var 取消钮 = p.createEmptyMovieClip("取消按钮", 60);
   取消钮._x = 262;
   取消钮._y = 顶 + 底高 - 40;
   取消钮.beginFill(13382451, 100);
   取消钮.moveTo(0, 0);
   取消钮.lineTo(116, 0);
   取消钮.lineTo(116, 28);
   取消钮.lineTo(0, 28);
   取消钮.lineTo(0, 0);
   取消钮.endFill();
   取消钮.onRelease = function()
   {
      _root.首页删读档面板();
   };
   var 取消框 = 取消钮.createTextField("取消文本", 1, 10, 5, 96, 20);
   取消框.setNewTextFormat(面板格式);
   取消框.textColor = 16777215;
   取消框.selectable = false;
   取消框.text = "cancel 取消";
}
function 读取记忆首页()
{
   var 有数据的 = Array();
   var i = 1;
   while(i <= 3)
   {
      if(存档_有数据(i))
      {
         有数据的.push(i);
      }
      i++;
   }
   if(有数据的.length == 0)
   {
      存档_反馈("没有找到存档 no save found  start a game and save first");
      return;
   }
   if (_root.系统设置 != undefined)
   {
      _root.系统设置.removeMovieClip();
   }
   _root.attachMovie("系统设置", "系统设置", 220, {_x:0, _y:0});
   _root.系统设置.gotoAndStop(4);
   _root.延迟刷新标题();
}
// ==================== 存档系统补丁 END ====================

