// Experimental association-only prompt. Not imported by the app or gateway.
export function photoObjectContext(objectName, fact) {
  return [
    `待核验的目标物件：${objectName}。候选：${JSON.stringify(fact)}。`,
    "目标物件是知识卡讨论的对象，不是要求整张照片的主体必须等于它。画面中清晰可辨的局部部件或次要物件也可以成为知识入口，不因面积小于主物件或属于主物件的一部分而拒绝。",
    "先独立观察目标是否真实出现，visibleEvidence用位置和可见外观说明依据。目标缺失、过小、遮挡或类别无法确认时仍拒绝；不能根据候选、常识或主物件通常会配备什么来补出看不见的对象。下面的必要子类型、适用范围和个体断言规则保持不变。"
  ].join("\n");
}
