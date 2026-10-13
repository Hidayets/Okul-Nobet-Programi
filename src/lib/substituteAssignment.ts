export interface SubstituteCandidate {
  id: string;
  /** Öğretmenin o gün dersinin olmadığı saatler */
  freeHours: Set<number>;
  /** Bugünden önce aldığı görevlendirme sayısı; yalnızca eşit bölünemeyen fazlalığı kimin alacağını belirler. */
  previousCount?: number;
}

export interface AssignSubstitutesOptions {
  /** O saatte boş nöbetçi kalmadıysa, o saatte zaten görevli bir nöbetçiye ikinci sınıf da verilir. */
  allowMerge?: boolean;
}

interface Edge {
  to: number;
  rev: number;
  cap: number;
  cost: number;
}

// Önce olabildiğince çok ders kapatılır, sonra o günkü yük eşitlenir; eşit bölünemeyen
// fazlalık geçmişte daha az görev alana gider. Bir öğretmen ancak o saatte başka müsait
// nöbetçi yoksa fazladan görev alır.
const COVER_REWARD = 1e12;
const DAILY_WEIGHT = 1e6;

/**
 * Derslere yerine görevli öğretmen atar. Bir öğretmen aynı saatte yalnızca bir derse girebilir.
 * Tüm gün birlikte çözülür (min-cost flow): saat sırasıyla açgözlü dağıtımın aksine, yalnızca
 * belirli saatlerde boş olan öğretmenler de görev alır ve kimse diğerleri boşken üst üste yüklenmez.
 * Dönüş: her ders için seçilen öğretmen id'si; kimse uygun değilse null.
 */
export function assignSubstitutes(
  lessons: { hour: number }[],
  candidates: SubstituteCandidate[],
  options: AssignSubstitutesOptions = {},
): (string | null)[] {
  const result: (string | null)[] = lessons.map(() => null);
  if (lessons.length === 0 || candidates.length === 0) return result;

  const graph: Edge[][] = [];
  const addNode = () => graph.push([]) - 1;
  const addEdge = (u: number, v: number, cap: number, cost: number) => {
    graph[u].push({ to: v, rev: graph[v].length, cap, cost });
    graph[v].push({ to: u, rev: graph[u].length - 1, cap: 0, cost: -cost });
  };

  const source = addNode();
  const sink = addNode();
  const lessonNodes = lessons.map(() => addNode());
  const lessonHours = new Set(lessons.map(l => l.hour));

  const slotNode = new Map<string, number>();
  const slotOwner = new Map<number, string>();
  candidates.forEach(c => {
    const teacherNode = addNode();
    let slots = 0;
    for (const hour of lessonHours) {
      if (!c.freeHours.has(hour)) continue;
      const node = addNode();
      slotNode.set(`${c.id}|${hour}`, node);
      slotOwner.set(node, c.id);
      addEdge(node, teacherNode, 1, 0);
      slots++;
    }
    // k. görevin maliyeti k ile artar: yük eşit dağıldıkça toplam maliyet düşer.
    const previous = c.previousCount ?? 0;
    for (let k = 1; k <= slots; k++) {
      addEdge(teacherNode, sink, 1, k * DAILY_WEIGHT + previous + k);
    }
  });

  lessons.forEach((lesson, i) => {
    addEdge(source, lessonNodes[i], 1, -COVER_REWARD);
    for (const c of candidates) {
      const node = slotNode.get(`${c.id}|${lesson.hour}`);
      if (node !== undefined) addEdge(lessonNodes[i], node, 1, 0);
    }
  });

  const n = graph.length;
  for (;;) {
    const dist = new Array<number>(n).fill(Infinity);
    const prevNode = new Array<number>(n).fill(-1);
    const prevEdge = new Array<number>(n).fill(-1);
    dist[source] = 0;
    for (let iter = 0; iter < n; iter++) {
      let changed = false;
      for (let u = 0; u < n; u++) {
        if (dist[u] === Infinity) continue;
        graph[u].forEach((e, idx) => {
          if (e.cap > 0 && dist[u] + e.cost < dist[e.to]) {
            dist[e.to] = dist[u] + e.cost;
            prevNode[e.to] = u;
            prevEdge[e.to] = idx;
            changed = true;
          }
        });
      }
      if (!changed) break;
    }
    if (dist[sink] === Infinity || dist[sink] >= 0) break;

    for (let v = sink; v !== source; v = prevNode[v]) {
      const e = graph[prevNode[v]][prevEdge[v]];
      e.cap -= 1;
      graph[v][e.rev].cap += 1;
    }
  }

  lessons.forEach((_, i) => {
    const used = graph[lessonNodes[i]].find(e => e.cap === 0 && slotOwner.has(e.to) && e.cost === 0);
    if (used) result[i] = slotOwner.get(used.to)!;
  });

  if (options.allowMerge) {
    const todayCount = new Map<string, number>();
    result.forEach(id => { if (id) todayCount.set(id, (todayCount.get(id) ?? 0) + 1); });
    lessons.forEach((lesson, i) => {
      if (result[i]) return;
      // Akış en çok dersi kapattığı için bu saatte boş olan herkes zaten bir derse girmiş durumda.
      const pool = candidates.filter(c => c.freeHours.has(lesson.hour));
      if (pool.length === 0) return;
      pool.sort((a, b) =>
        (todayCount.get(a.id) ?? 0) - (todayCount.get(b.id) ?? 0)
        || (a.previousCount ?? 0) - (b.previousCount ?? 0),
      );
      const chosen = pool[0].id;
      result[i] = chosen;
      todayCount.set(chosen, (todayCount.get(chosen) ?? 0) + 1);
    });
  }
  return result;
}
