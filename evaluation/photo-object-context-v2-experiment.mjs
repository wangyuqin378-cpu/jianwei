import {photoObjectContext} from './photo-object-context-experiment.mjs';

export function applyPhotoObjectContextV2(prompt, objectName, fact) {
  const oldContext=`照片基础对象应为：${objectName}。候选：${JSON.stringify(fact)}。`;
  if(prompt.split(oldContext).length!==2)throw new Error('Expected one object context');
  let result=prompt.replace(oldContext,photoObjectContext(objectName,fact));
  const oldGeneral="这条卡片适用于整个基础物件类别。照片只需清楚确认基础类别；一般内部机制、历史来历或明确写成‘某年一种设计’的历史实例不要求在照片里可见，只要文案没有声称照片中的这个个体就具有该结构。";
  if(result.includes(oldGeneral))result=result.replace(oldGeneral,[
    "photoRequirement只规定要看见什么，不证明标题正文的断言成立。先读完整标题和正文，独立判断scopeGrounded；不能因为基础对象可见就顺带把文案也判为真实。",
    "不指向照片个体的一般原理、历史背景，或正文明确限定的某类设计，不要求内部机制在照片里可见。相反，文案若把内部结构、材料、型号、年代或使用状态直接说成照片中这个个体的属性，必须有图中能辨认的依据；不能确认就scopeGrounded=false、accepted=false，即使objectMatches=true。",
    "对象可见与个体断言可核验是两个独立问题。逐项检查文案实际说了什么，不将候选作者的描述或photoRequirement当成观察结果。"
  ].join('\n'));
  return result;
}
