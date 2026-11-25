import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Trash2, MapPin, ChevronDown, GripVertical, Plus, UserPlus, X, Copy } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { Location, LocationDuty, Teacher, sortLocationsByOrder } from '../types';
import { describeDailyDuty, getWeeklyDutyCount, maxDailyDuties } from '../lib/weeklyQuota';

interface Props {
  locations: Location[];
  setLocations: React.Dispatch<React.SetStateAction<Location[]>>;
  /** Silinen nöbet yerlerinin çizelgedeki nöbetlerini temizler. */
  onLocationsRemoved?: (ids: string[]) => void;
  teachers: Teacher[];
  /** Haftada kaç gün nöbet tutulduğu (okul günleri) */
  schoolDayCount?: number;
  /** Nöbet tablosunun gün sütunları (okul günleri). Varsayılan: Pazartesi-Cuma. */
  schoolDays?: number[];
}

const DAY_LABELS: Record<number, string> = {
  0: 'Pazar', 1: 'Pazartesi', 2: 'Salı', 3: 'Çarşamba', 4: 'Perşembe', 5: 'Cuma', 6: 'Cumartesi',
};

export default function LocationsTab({ locations, setLocations, onLocationsRemoved, teachers, schoolDayCount = 5, schoolDays = [1, 2, 3, 4, 5] }: Props) {
  const [newLocationName, setNewLocationName] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const dragOverId = useRef<string | null>(null);

  const eligibleTeachers = teachers.filter(t => t.dutyType !== 'nobetDisi');

  const teacherById = new Map(teachers.map(t => [t.id, t]));

  const sortedLocations = useMemo(() => sortLocationsByOrder(locations), [locations]);

  // Nöbet tablosunun gün sütunları (Pazartesi ilk olacak şekilde sıralanır).
  const dayKey = schoolDays.join(',');
  const dayList = useMemo(
    () => [...new Set(schoolDays)].sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b)),
    [dayKey],
  );

  const assignedLocationsOf = (teacherId: string): Location[] =>
    sortedLocations.filter(loc => (loc.assignedTeacherIds || []).includes(teacherId));

  // Öğretmenin ilk hafta tablosunda yazılacağı gün: sabit günü varsa o, yoksa en az dolu gün.
  const pickDayFor = (location: Location, teacherId: string, duties: LocationDuty[]): number => {
    const preferred = teacherById.get(teacherId)?.preferredDay;
    if (typeof preferred === 'number' && dayList.includes(preferred)) return preferred;
    if (dayList.length === 0) return typeof preferred === 'number' ? preferred : 1;
    let best = dayList[0];
    let bestCount = Infinity;
    for (const day of dayList) {
      const count = duties.filter(d => d.day === day).length;
      if (count < bestCount) {
        bestCount = count;
        best = day;
      }
    }
    return best;
  };

  const handleAssignTeacher = (locationId: string, teacherId: string) => {
    if (!teacherId) return;
    // Kapasite: yer, haftalık nöbetçi sayısından fazla öğretmen kabul etmez.
    const target = sortedLocations.find(l => l.id === locationId);
    if (target) {
      const current = target.assignedTeacherIds || [];
      if (current.includes(teacherId)) return;
      const capacity = getWeeklyDutyCount(target);
      if (current.length >= capacity) {
        alert(`"${target.name}" nöbet yeri haftada en fazla ${capacity} öğretmen kabul eder. Daha fazla atamak için haftalık nöbetçi sayısını artırın.`);
        return;
      }
    }
    setLocations(prev => prev.map(loc => {
      if (loc.id !== locationId) return loc;
      const current = loc.assignedTeacherIds || [];
      if (current.includes(teacherId)) return loc;
      const duties = loc.duties || [];
      const day = pickDayFor(loc, teacherId, duties);
      return { ...loc, assignedTeacherIds: [...current, teacherId], duties: [...duties, { teacherId, day }] };
    }));
  };

  const handleUnassignTeacher = (locationId: string, teacherId: string) => {
    setLocations(prev => prev.map(loc => {
      if (loc.id !== locationId) return loc;
      return {
        ...loc,
        assignedTeacherIds: (loc.assignedTeacherIds || []).filter(id => id !== teacherId),
        duties: (loc.duties || []).filter(d => d.teacherId !== teacherId),
      };
    }));
  };
  
  const handleChangeWeeklyDutyCount = (locationId: string, newCount: number) => {
    if (newCount < 0 || newCount > 10) return; // Mantıklı bir sınır
    setLocations(prev => prev.map(loc => {
      if (loc.id !== locationId) return loc;
      return { ...loc, weeklyDutyCount: newCount };
    }));
  };

  // Nöbet tablosunda sürüklenen öğretmen ve hedef hücre vurgusu.
  const [gridDrag, setGridDrag] = useState<{ locationId: string; teacherId: string } | null>(null);
  const [gridOver, setGridOver] = useState<string | null>(null);

  // Tablodaki öğretmene sağ tıklandığında açılan hızlı işlem menüsü.
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; locationId: string; teacherId: string } | null>(null);

  // Menü dışına tıklanınca / kaydırılınca menüyü kapat.
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [contextMenu]);

  // Dolu öğretmen çipine bırakılırsa görev yerlerini takas eder; boş hücreye bırakılırsa taşır.
  const handleGridDrop = (targetLocationId: string, targetDay: number, targetTeacherId?: string) => {
    const drag = gridDrag;
    setGridDrag(null);
    setGridOver(null);
    if (!drag) return;
    const { locationId: srcLocationId, teacherId } = drag;

    if (targetTeacherId) {
      if (teacherId === targetTeacherId) return;
      const sourceLocation = sortedLocations.find(loc => loc.id === srcLocationId);
      const targetLocation = sortedLocations.find(loc => loc.id === targetLocationId);
      const sourceDuty = sourceLocation?.duties?.find(duty => duty.teacherId === teacherId);
      const targetDuty = targetLocation?.duties?.find(duty => duty.teacherId === targetTeacherId);
      if (!sourceLocation || !targetLocation || !sourceDuty || !targetDuty) return;

      const locationsToIgnore = new Set([srcLocationId, targetLocationId]);
      const hasOtherLocationDuty = (id: string, day: number) =>
        sortedLocations.some(loc =>
          !locationsToIgnore.has(loc.id) &&
          (loc.duties || []).some(duty => duty.teacherId === id && duty.day === day),
        );

      if (srcLocationId === targetLocationId) {
        if (sourceDuty.day === targetDuty.day) return;
        if (
          hasOtherLocationDuty(teacherId, targetDuty.day) ||
          hasOtherLocationDuty(targetTeacherId, sourceDuty.day)
        ) {
          alert('Takas yapılamadı: Öğretmenlerden biri aynı gün başka bir nöbet yerinde görevli.');
          return;
        }
        setLocations(prev => prev.map(loc => {
          if (loc.id !== srcLocationId) return loc;
          return {
            ...loc,
            duties: (loc.duties || []).map(duty => {
              if (duty.teacherId === teacherId) return { ...duty, day: targetDuty.day };
              if (duty.teacherId === targetTeacherId) return { ...duty, day: sourceDuty.day };
              return duty;
            }),
          };
        }));
        return;
      }

      const sourceIds = sourceLocation.assignedTeacherIds || [];
      const targetIds = targetLocation.assignedTeacherIds || [];
      if (
        sourceIds.includes(targetTeacherId) ||
        targetIds.includes(teacherId) ||
        (sourceLocation.duties || []).some(duty => duty.teacherId === targetTeacherId) ||
        (targetLocation.duties || []).some(duty => duty.teacherId === teacherId)
      ) {
        alert('Takas yapılamadı: Bu öğretmenlerden biri hedef nöbet yerinde zaten görevli.');
        return;
      }
      if (
        hasOtherLocationDuty(teacherId, targetDuty.day) ||
        hasOtherLocationDuty(targetTeacherId, sourceDuty.day)
      ) {
        alert('Takas yapılamadı: Öğretmenlerden biri aynı gün başka bir nöbet yerinde görevli.');
        return;
      }

      setLocations(prev => prev.map(loc => {
        if (loc.id === srcLocationId) {
          return {
            ...loc,
            assignedTeacherIds: (loc.assignedTeacherIds || []).map(id => id === teacherId ? targetTeacherId : id),
            duties: (loc.duties || []).map(duty => duty.teacherId === teacherId
              ? { ...duty, teacherId: targetTeacherId }
              : duty),
          };
        }
        if (loc.id !== targetLocationId) return loc;
        return {
          ...loc,
          assignedTeacherIds: (loc.assignedTeacherIds || []).map(id => id === targetTeacherId ? teacherId : id),
          duties: (loc.duties || []).map(duty => duty.teacherId === targetTeacherId
            ? { ...duty, teacherId }
            : duty),
        };
      }));
      return;
    }

    // Boş hücreye bırakıldığında öğretmeni hedef yere/güne taşır.
    if (srcLocationId === targetLocationId) {
      setLocations(prev => prev.map(loc => {
        if (loc.id !== targetLocationId) return loc;
        return {
          ...loc,
          duties: (loc.duties || []).map(d => (d.teacherId === teacherId ? { ...d, day: targetDay } : d)),
        };
      }));
      return;
    }

    // Farklı yere taşınırsa öğretmen eski yerden çıkar, yeni yere yazılır.
    // Hedef yer kapasitesi (haftalık nöbetçi sayısı) doluysa taşıma engellenir.
    const targetLoc = sortedLocations.find(l => l.id === targetLocationId);
    if (targetLoc) {
      const current = targetLoc.assignedTeacherIds || [];
      const capacity = getWeeklyDutyCount(targetLoc);
      if (!current.includes(teacherId) && current.length >= capacity) {
        alert(`"${targetLoc.name}" nöbet yeri haftada en fazla ${capacity} öğretmen kabul eder. Taşıma yapılmadı.`);
        return;
      }
    }
    setLocations(prev => prev.map(loc => {
      if (loc.id === srcLocationId) {
        return {
          ...loc,
          assignedTeacherIds: (loc.assignedTeacherIds || []).filter(id => id !== teacherId),
          duties: (loc.duties || []).filter(d => d.teacherId !== teacherId),
        };
      }
      if (loc.id === targetLocationId) {
        const current = loc.assignedTeacherIds || [];
        return {
          ...loc,
          assignedTeacherIds: current.includes(teacherId) ? current : [...current, teacherId],
          duties: [...(loc.duties || []).filter(d => d.teacherId !== teacherId), { teacherId, day: targetDay }],
        };
      }
      return loc;
    }));
  };

  // Haftalık nöbetçi sayısına göre ilk haftayı öğretmenlerle doldurur (örnek program).
  const handleAutoAssignFirstWeek = () => {
    const pool = teachers.filter(t => t.dutyType !== 'nobetDisi');
    if (pool.length === 0 || dayList.length === 0) return;

    setLocations(prev => {
      const ordered = sortLocationsByOrder(prev);

      // Öğretmenin hangi günlerde nöbeti var (aynı gün çakışmasını önlemek için) ve atanmış öğretmenler.
      const teacherDays = new Map<string, Set<number>>();
      const used = new Set<string>();
      for (const loc of ordered) {
        for (const id of loc.assignedTeacherIds || []) used.add(id);
        for (const duty of loc.duties || []) {
          if (!teacherDays.has(duty.teacherId)) teacherDays.set(duty.teacherId, new Set());
          teacherDays.get(duty.teacherId)!.add(duty.day);
        }
      }

      // Öğretmenin diğer nöbetleriyle çakışmayan, en az dolu günü seçer.
      const pickDay = (teacherId: string, duties: LocationDuty[]): number => {
        const busy = teacherDays.get(teacherId) ?? new Set<number>();
        const free = dayList.filter(day => !busy.has(day));
        const candidates = free.length > 0 ? free : dayList;
        const preferred = teacherById.get(teacherId)?.preferredDay;
        if (typeof preferred === 'number' && candidates.includes(preferred)) return preferred;
        let best = candidates[0];
        let bestCount = Infinity;
        for (const day of candidates) {
          const count = duties.filter(d => d.day === day).length;
          if (count < bestCount) {
            bestCount = count;
            best = day;
          }
        }
        return best;
      };

      let cursor = 0;
      const result = new Map<string, Location>();

      for (const loc of ordered) {
        const duties = [...(loc.duties || [])];
        const assigned = [...(loc.assignedTeacherIds || [])];
        const target = Math.max(0, getWeeklyDutyCount(loc));

        while (assigned.length < target) {
          // Önce hiçbir yere atanmamış öğretmen; yoksa bu yerde olmayan herhangi biri.
          let candidate: Teacher | undefined;
          for (let step = 0; step < pool.length; step++) {
            const current = pool[(cursor + step) % pool.length];
            if (!used.has(current.id) && !assigned.includes(current.id)) {
              candidate = current;
              cursor = (cursor + step + 1) % pool.length;
              break;
            }
          }
          if (!candidate) {
            for (let step = 0; step < pool.length; step++) {
              const current = pool[(cursor + step) % pool.length];
              if (!assigned.includes(current.id)) {
                candidate = current;
                cursor = (cursor + step + 1) % pool.length;
                break;
              }
            }
          }
          if (!candidate) break; // Bu yeri dolduracak öğretmen yok.

          const day = pickDay(candidate.id, duties);
          used.add(candidate.id);
          assigned.push(candidate.id);
          duties.push({ teacherId: candidate.id, day });
          if (!teacherDays.has(candidate.id)) teacherDays.set(candidate.id, new Set());
          teacherDays.get(candidate.id)!.add(day);
        }

        result.set(loc.id, { ...loc, assignedTeacherIds: assigned, duties });
      }

      return prev.map(loc => result.get(loc.id) ?? loc);
    });
  };

  // İlk hafta tablosundaki tüm atamaları siler (nöbet yerleri ve haftalık sayılar korunur).
  const handleClearTable = () => {
    if (!confirm('Tablodaki tüm öğretmen atamaları silinsin mi? Nöbet yerleri ve haftalık nöbetçi sayıları korunur.')) return;
    setLocations(prev => prev.map(loc => ({ ...loc, assignedTeacherIds: [], duties: [] })));
  };

  const unassignedLocationCount = sortedLocations.filter(
    loc => (loc.assignedTeacherIds || []).length < Math.max(0, getWeeklyDutyCount(loc)),
  ).length;

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    dragOverId.current = id;
  };

  const handleDragEnd = () => {
    if (draggedId && dragOverId.current && draggedId !== dragOverId.current) {
      setLocations(prev => {
        // Ekranda görünen sıra "order" alanına göredir; sunucudan gelen dizi sırası farklı olabilir.
        const ordered = sortLocationsByOrder(prev);
        const fromIdx = ordered.findIndex(l => l.id === draggedId);
        const toIdx = ordered.findIndex(l => l.id === dragOverId.current);
        if (fromIdx < 0 || toIdx < 0) return prev;
        const newList = [...ordered];
        const [moved] = newList.splice(fromIdx, 1);
        newList.splice(toIdx, 0, moved);
        // Order alanlarını güncelle
        return newList.map((loc, idx) => ({ ...loc, order: idx }));
      });
    }
    setDraggedId(null);
    dragOverId.current = null;
  };

  const handleAddLocation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLocationName.trim()) return;

    const newLocation: Location = {
      id: uuidv4(),
      name: newLocationName.trim(),
      duties: [],
      weeklyDutyCount: 1, // Varsayılan olarak haftada 1 nöbetçi
    };

    // Sıra numarası olmayan eski kayıtlar da numaralanır; yeni yer her zaman sona eklenir.
    setLocations(prev => [
      ...sortLocationsByOrder(prev).map((loc, idx) => (loc.order === idx ? loc : { ...loc, order: idx })),
      { ...newLocation, order: prev.length },
    ]);
    setNewLocationName('');
    setExpandedId(newLocation.id);
  };

  const handleDeleteLocation = (location: Location) => {
    if (!confirm(`"${location.name}" nöbet yeri silinsin mi? Mevcut çizelgedeki bu yere ait nöbetler de silinir.`)) return;
    setLocations(prev => prev.filter((l) => l.id !== location.id));
    onLocationsRemoved?.([location.id]);
    if (expandedId === location.id) setExpandedId(null);
  };





  return (
    <div className="space-y-6">
      <div className="bg-surface p-6 rounded-xl shadow-sm border border-slate-200">
        <h2 className="text-lg font-semibold mb-4">Yeni Nöbet Yeri Ekle</h2>
        <form onSubmit={handleAddLocation} className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={newLocationName}
            onChange={(e) => setNewLocationName(e.target.value)}
            placeholder="Nöbet Yeri Adı (Örn: Bahçe, 1. Kat)"
            className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
          <button
            type="submit"
            disabled={!newLocationName.trim()}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Plus className="w-5 h-5" />
            Ekle
          </button>
        </form>
      </div>

      <div className="bg-surface rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50">
          <h2 className="text-lg font-semibold">Kayıtlı Nöbet Yerleri ({sortedLocations.length})</h2>
          <p className="text-sm text-slate-500 mt-1">Her nöbet yeri için haftada toplam kaç nöbetçi tutulacağını belirleyin. (Örn: {schoolDayCount} ise her gün 1 kişi)</p>
        </div>

        {sortedLocations.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            Henüz nöbet yeri eklenmemiş.
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {sortedLocations.map((location) => {
              const isExpanded = expandedId === location.id;
              const weeklyDutyCount = getWeeklyDutyCount(location);
              const isDragging = draggedId === location.id;
              const assignedIds = (location.assignedTeacherIds || []).filter(id => teacherById.has(id));
              const assignedCount = assignedIds.length;
              const doubleCount = assignedIds.filter(id => assignedLocationsOf(id).length > 1).length;
              const dailyDutyLabel = describeDailyDuty(weeklyDutyCount, schoolDayCount);
              const dailyDutyCount = maxDailyDuties(weeklyDutyCount, schoolDayCount);
              // Yer, haftalık nöbetçi sayısı kadar öğretmen kabul eder.
              const isAtCapacity = assignedCount >= weeklyDutyCount;

              return (
                <div
                  key={location.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, location.id)}
                  onDragOver={(e) => handleDragOver(e, location.id)}
                  onDragEnd={handleDragEnd}
                  className={`${isDragging ? 'opacity-50 bg-indigo-50' : ''}`}
                >
                  <div
                    className="px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : location.id)}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div
                        className="text-slate-400 hover:text-slate-600 cursor-grab active:cursor-grabbing flex-shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <GripVertical className="w-5 h-5" />
                      </div>
                      <div className="bg-indigo-100 p-2 rounded-lg text-indigo-600 flex-shrink-0">
                        <MapPin className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <span className="font-medium text-slate-700 block">{location.name}</span>
                        <span className="text-xs text-indigo-600">Haftada {weeklyDutyCount} nöbetçi ({dailyDutyLabel})</span>
                        {location.extraDutyPlace && (
                          <span className="text-xs text-slate-600 block">İkinci nöbet yeri</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${assignedCount > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {assignedCount} öğretmen
                      </span>
                      {doubleCount > 0 && (
                        <span
                          className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800"
                          title="Başka bir nöbet yerinde de atanmış öğretmen sayısı"
                        >
                          <Copy className="w-3 h-3" />
                          {doubleCount} çift
                        </span>
                      )}
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700`}>
                        {weeklyDutyCount}/hafta
                      </span>
                      <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteLocation(location); }}
                        className="text-red-500 hover:text-red-700 p-2 rounded-lg hover:bg-red-50 transition-colors"
                        title="Sil"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-6 pb-5 bg-slate-50/50">
                      <div className="space-y-5">
                        <div className="space-y-3">
                          <h4 className="text-sm font-medium text-slate-600">Haftalık Nöbetçi Sayısı</h4>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => handleChangeWeeklyDutyCount(location.id, Math.max(0, weeklyDutyCount - 1))}
                              className="w-8 h-8 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold transition-colors"
                            >
                              -
                            </button>
                            <div className="w-16 text-center">
                              <span className="text-2xl font-bold text-slate-800">{weeklyDutyCount}</span>
                            </div>
                            <button
                              onClick={() => handleChangeWeeklyDutyCount(location.id, Math.min(10, weeklyDutyCount + 1))}
                              className="w-8 h-8 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold transition-colors"
                            >
                              +
                            </button>
                          </div>
                          <p className="text-xs text-slate-500 mt-2">
                            Bu nöbet yeri için haftada {weeklyDutyCount} kişi nöbet tutacak ({dailyDutyLabel}).
                          </p>
                          <label className="flex items-start gap-2 pt-1 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={!!location.extraDutyPlace}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setLocations(prev => prev.map(loc => (
                                  loc.id === location.id ? { ...loc, extraDutyPlace: checked } : loc
                                )));
                              }}
                            />
                            <span>
                              <span className="font-medium">İkinci nöbet yeri</span>
                              <span className="block text-xs text-slate-500">
                                İşaretlerseniz aynı haftadaki ikinci ve sonraki nöbetler yalnız bu tür yerlere yazılır.
                                Örneğin Bahçe ve Zemin Kat. Hiçbir yer işaretli değilse ikinci nöbet her alana gelebilir.
                                Sığması için bu yerin haftalık sayısını artırın.
                              </span>
                            </span>
                          </label>
                        </div>

                        <div className="space-y-3 pt-3 border-t border-slate-200">
                          <h4 className="text-sm font-medium text-slate-600">Nöbetçi Öğretmen Ata</h4>
                          <p className="text-xs text-slate-500 -mt-2">
                            Atadığınız öğretmenler program oluşturulurken nöbet dönüş şekline göre yerleştirilir:
                            <strong className="text-slate-600"> Sabit</strong> öğretmenler hep bu yerde görev yapar,
                            <strong className="text-slate-600"> hareketli</strong> öğretmenlerin yeri haftalık döner.
                            Aynı öğretmen aynı gün iki farklı alanda nöbet tutmaz.
                            Haftalık ihtiyaç öğretmen sayısından fazlaysa ikinci nöbet, aynı haftanın alternatif gününe yazılır.
                          </p>

                          {assignedIds.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {assignedIds.map(tid => {
                                const t = teacherById.get(tid);
                                if (!t) return null;
                                const isHareketli = t.dutyType === 'hareketli';
                                const otherPlaces = assignedLocationsOf(tid).filter(l => l.id !== location.id);
                                const isDouble = otherPlaces.length > 0;
                                return (
                                  <span
                                    key={tid}
                                    className={`inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-full text-xs font-medium border ${
                                      isDouble
                                        ? 'bg-amber-50 border-amber-300 text-amber-800'
                                        : isHareketli
                                          ? 'bg-violet-50 border-violet-200 text-violet-700'
                                          : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                    }`}
                                    title={isDouble ? `Çift nöbet: ${otherPlaces.map(l => l.name).join(', ')} yerinde de görevli` : undefined}
                                  >
                                    {t.name}
                                    {t.dutyType === 'nobetDisi' ? (
                                      <span
                                        className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700"
                                        title="Öğretmen Nöbet Dışı olarak işaretli; programa alınmaz"
                                      >
                                        Nöbet Dışı
                                      </span>
                                    ) : (
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${isDouble ? 'bg-amber-100' : isHareketli ? 'bg-violet-100' : 'bg-emerald-100'}`}>
                                        {isHareketli ? 'Hareketli' : 'Sabit'}
                                      </span>
                                    )}
                                    {isDouble && (
                                      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500 text-white">
                                        <Copy className="w-3 h-3" />
                                        Çift nöbet
                                      </span>
                                    )}
                                    <button
                                      onClick={() => handleUnassignTeacher(location.id, tid)}
                                      className="p-0.5 rounded-full hover:bg-red-100 text-slate-400 hover:text-red-600 transition-colors"
                                      title="Atamayı kaldır"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </span>
                                );
                              })}
                            </div>
                          )}

                          <div className="flex items-center gap-2">
                            <div className="relative flex-1">
                              <UserPlus className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                              <select
                                value=""
                                disabled={isAtCapacity}
                                onChange={(e) => handleAssignTeacher(location.id, e.target.value)}
                                className={`w-full pl-9 pr-4 py-2 border rounded-lg text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                                  isAtCapacity
                                    ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                                    : 'bg-surface border-slate-300 text-slate-700'
                                }`}
                              >
                                <option value="">
                                  {isAtCapacity
                                    ? `Kapasite dolu (${assignedCount}/${weeklyDutyCount})`
                                    : 'Öğretmen seçin…'}
                                </option>
                                {eligibleTeachers.map(t => {
                                  const elsewhere = assignedLocationsOf(t.id);
                                  const isHere = assignedIds.includes(t.id);
                                  if (isHere) return null;
                                  return (
                                    <option key={t.id} value={t.id}>
                                      {elsewhere.length > 0 ? '⧉ ' : ''}{t.name}
                                      {elsewhere.length > 0
                                        ? ` — ${elsewhere.map(l => l.name).join(', ')} yerinde de var (çift nöbet olur)`
                                        : t.dutyType === 'hareketli' ? ' (Hareketli)' : ''}
                                    </option>
                                  );
                                })}
                              </select>
                            </div>
                          </div>

                          {isAtCapacity && (
                            <div className="p-2.5 bg-slate-100 border border-slate-200 rounded-lg">
                              <p className="text-xs text-slate-600">
                                Bu yer haftalık nöbetçi sayısına ulaştı ({assignedCount}/{weeklyDutyCount}).
                                Daha fazla öğretmen atamak için yukarıdan haftalık nöbetçi sayısını artırın.
                              </p>
                            </div>
                          )}

                          {dailyDutyCount > 0 && assignedIds.length > 0 && assignedIds.length < dailyDutyCount && (
                            <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
                              <p className="text-xs text-amber-700">
                                Bu yerde her gün {dailyDutyCount} nöbetçi görev yapacak; {assignedIds.length} öğretmen atadınız.
                                Eksik slotlar nöbet dönüş şekline göre diğer öğretmenlerden tamamlanır.
                              </p>
                            </div>
                          )}

                          {dailyDutyCount > 0 && assignedIds.length >= dailyDutyCount && (
                            <p className="text-xs text-slate-500">
                              Atanan {assignedIds.length} öğretmen, haftanın günlerine nöbet dönüş şekline göre dağıtılır.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Nöbet Tablosu — İlk Hafta */}
      <div className="bg-surface rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-[240px]">
            <h2 className="text-lg font-semibold">Nöbet Tablosu — İlk Hafta</h2>
            <p className="text-sm text-slate-500 mt-1">
              Bu tablo, oluşturulacak nöbet programının ilk haftasıdır. Öğretmeni boş hücreye sürükleyerek taşıyabilir,
              dolu hücredeki öğretmenin üzerine bırakarak ikisinin görevini <strong className="text-slate-600">takas edebilirsiniz</strong>.
            </p>
          </div>
          <button
            type="button"
            onClick={handleAutoAssignFirstWeek}
            disabled={sortedLocations.length === 0 || eligibleTeachers.length === 0 || unassignedLocationCount === 0}
            title="Yalnızca nöbetçi sayısı belirtilmiş yerlere, o sayı kadar öğretmen atayıp ilk haftayı oluşturur."
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          >
            <UserPlus className="w-4 h-4" />
            İlk Haftayı Otomatik Ata
          </button>
          <button
            type="button"
            onClick={handleClearTable}
            disabled={sortedLocations.length === 0}
            title="İlk hafta tablosundaki tüm öğretmen atamalarını siler."
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border border-slate-300 text-slate-600 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          >
            <Trash2 className="w-4 h-4" />
            Tabloyu Temizle
          </button>
        </div>

        {sortedLocations.length === 0 || dayList.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            {sortedLocations.length === 0
              ? 'Tabloyu oluşturmak için önce nöbet yeri ekleyin.'
              : 'Ayarlar bölümünden okul günleri seçilmeli.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50">
                  <th className="text-left px-4 py-3 font-semibold text-slate-600 border-b border-r border-slate-200 sticky left-0 bg-slate-50 z-10 min-w-[170px]">
                    Nöbet Yeri
                  </th>
                  {dayList.map(day => (
                    <th
                      key={day}
                      className="px-3 py-3 font-semibold text-slate-600 border-b border-r border-slate-200 min-w-[150px] text-center"
                    >
                      {DAY_LABELS[day] ?? day}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedLocations.map(location => (
                  <tr key={location.id} className="border-b border-slate-100 last:border-b-0">
                    <td className="px-4 py-3 font-medium text-slate-700 align-top sticky left-0 bg-surface z-10 border-r border-slate-100">
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-indigo-500 flex-shrink-0" />
                        <span>{location.name}</span>
                      </div>
                      <span className="text-xs text-slate-400">Haftada {getWeeklyDutyCount(location)} nöbetçi</span>
                    </td>
                    {dayList.map(day => {
                      const cellKey = `${location.id}::${day}`;
                      const cellTeachers = (location.duties || [])
                        .filter(d => d.day === day)
                        .filter(d => teacherById.has(d.teacherId));
                      const isOver = gridOver === cellKey;
                      return (
                        <td
                          key={day}
                          onDragOver={(e) => {
                            if (!gridDrag) return;
                            e.preventDefault();
                            setGridOver(cellKey);
                          }}
                          onDragLeave={() => setGridOver(cur => (cur === cellKey ? null : cur))}
                          onDrop={(e) => {
                            e.preventDefault();
                            handleGridDrop(location.id, day);
                          }}
                          className={`px-2 py-2 align-top border-r border-slate-100 transition-colors ${
                            isOver ? 'bg-indigo-50 ring-1 ring-inset ring-indigo-300' : ''
                          }`}
                        >
                          <div className="flex flex-col gap-1 min-h-[34px]">
                            {cellTeachers.length === 0 ? (
                              <span className="text-[11px] text-slate-300 select-none">—</span>
                            ) : (
                              cellTeachers.map(duty => {
                                const teacher = teacherById.get(duty.teacherId);
                                if (!teacher) return null;
                                const isHareketli = teacher.dutyType === 'hareketli';
                                const isDragging = gridDrag?.locationId === location.id && gridDrag?.teacherId === duty.teacherId;
                                return (
                                  <div
                                    key={duty.teacherId}
                                    draggable
                                    onDragOver={(e) => {
                                      if (!gridDrag) return;
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setGridOver(cellKey);
                                    }}
                                    onDrop={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      handleGridDrop(location.id, day, duty.teacherId);
                                    }}
                                    onContextMenu={(e) => {
                                      e.preventDefault();
                                      setContextMenu({ x: e.clientX, y: e.clientY, locationId: location.id, teacherId: duty.teacherId });
                                    }}
                                    onDragStart={(e) => {
                                      setGridDrag({ locationId: location.id, teacherId: duty.teacherId });
                                      e.dataTransfer.effectAllowed = 'move';
                                    }}
                                    onDragEnd={() => {
                                      setGridDrag(null);
                                      setGridOver(null);
                                    }}
                                    title={`${teacher.name} — ${DAY_LABELS[day] ?? day} (sürükleyin; başka öğretmenin üzerine bırakınca takas edilir; sağ tık: tablodan çıkar)`}
                                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border cursor-grab active:cursor-grabbing ${
                                      isHareketli
                                        ? 'bg-violet-50 border-violet-200 text-violet-700'
                                        : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                    } ${isDragging ? 'opacity-40' : ''}`}
                                  >
                                    <GripVertical className="w-3 h-3 text-slate-400 flex-shrink-0" />
                                    <span className="truncate">{teacher.name}</span>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Tablodaki öğretmene sağ tık menüsü */}
      {contextMenu && (() => {
        const ctxTeacher = teacherById.get(contextMenu.teacherId);
        const ctxLocation = sortedLocations.find(l => l.id === contextMenu.locationId);
        if (!ctxTeacher || !ctxLocation) return null;
        const left = Math.max(8, Math.min(contextMenu.x, window.innerWidth - 216));
        const top = Math.max(8, Math.min(contextMenu.y, window.innerHeight - 104));
        return (
          <div
            className="fixed z-50 min-w-[200px] bg-surface border border-slate-200 rounded-xl shadow-xl py-1"
            style={{ left, top }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div className="px-3 py-1.5 border-b border-slate-100">
              <p className="text-sm font-medium text-slate-700 truncate">{ctxTeacher.name}</p>
              <p className="text-[11px] text-slate-400 truncate">{ctxLocation.name}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                handleUnassignTeacher(contextMenu.locationId, contextMenu.teacherId);
                setContextMenu(null);
              }}
              className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 transition-colors"
            >
              <X className="w-4 h-4" />
              Tablodan çıkar
            </button>
          </div>
        );
      })()}
    </div>
  );
}
