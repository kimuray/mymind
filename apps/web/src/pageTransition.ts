/**
 * 画面を移るときの切り替えの種類（DESIGN.md 2.9、FR-U04）。
 * 同じ画面の中の移動（カレンダーで日を選ぶ、振り返りの日を変える、など）では切り替えない（false）。
 * カレンダーの月を移るときは、進む向き（forward / backward）で横から入れる。
 */
export function viewTransitionTypes(
  fromPath: string | undefined,
  toPath: string,
): string[] | false {
  if (fromPath === undefined) return false;
  const from = fromPath.split('/').filter((s) => s !== '');
  const to = toPath.split('/').filter((s) => s !== '');
  const fromScreen = from[0] ?? '';
  const toScreen = to[0] ?? '';
  if (fromScreen !== toScreen) return ['page'];
  // カレンダー（/calendar/:ym/:day?）だけは、月が変わったら切り替える。日の選択では切り替えない
  if (toScreen === 'calendar') {
    const fromMonth = from[1] ?? '';
    const toMonth = to[1] ?? '';
    if (fromMonth === toMonth) return false;
    return [toMonth > fromMonth ? 'forward' : 'backward'];
  }
  return false;
}
