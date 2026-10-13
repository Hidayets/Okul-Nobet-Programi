import React, { useState, useRef, useMemo } from 'react';
import { Trash2, MapPin, ChevronDown, GripVertical, Plus, UserPlus, X, Copy } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { Location, Teacher, sortLocationsByOrder } from '../types';
import { describeDailyDuty, getWeeklyDutyCount, maxDailyDuties } from '../lib/weeklyQuota';

interface Props {
  locations: Location[];
  setLocations: React.Dispatch<React.SetStateAction<Location[]>>;
  /** Silinen nöbet yerlerinin çizelgedeki nöbetlerini temizler. */
  onLocationsRemoved?: (ids: string[]) => void;
  teachers: Teacher[];
  /** Haftada kaç gün nöbet tutulduğu (okul günleri) */
  schoolDayCount?: number;
}

export default function LocationsTab({ locations, setLocations, onLocationsRemoved, teachers, schoolDayCount = 5 }: Props) {
  const [newLocationName, setNewLocationName] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const dragOverId = useRef<string | null>(null);

  const eligibleTeachers = teachers.filter(t => t.dutyType !== 'nobetDisi');

  const teacherById = new Map(teachers.map(t => [t.id, t]));

  const sortedLocations = useMemo(() => sortLocationsByOrder(locations), [locations]);

  const assignedLocationsOf = (teacherId: string): Location[] =>
    sortedLocations.filter(loc => (loc.assignedTeacherIds || []).includes(teacherId));

  const handleAssignTeacher = (locationId: string, teacherId: string) => {
    if (!teacherId) return;
    setLocations(prev => prev.map(loc => {
      if (loc.id !== locationId) return loc;
      const current = loc.assignedTeacherIds || [];
      if (current.includes(teacherId)) return loc;
      return { ...loc, assignedTeacherIds: [...current, teacherId] };
    }));
  };

  const handleUnassignTeacher = (locationId: string, teacherId: string) => {
    setLocations(prev => prev.map(loc => {
      if (loc.id !== locationId) return loc;
      return { ...loc, assignedTeacherIds: (loc.assignedTeacherIds || []).filter(id => id !== teacherId) };
    }));
  };
  
  const handleChangeWeeklyDutyCount = (locationId: string, newCount: number) => {
    if (newCount < 0 || newCount > 10) return; // Mantıklı bir sınır
    setLocations(prev => prev.map(loc => {
      if (loc.id !== locationId) return loc;
      return { ...loc, weeklyDutyCount: newCount };
    }));
  };

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
                        </div>

                        <div className="space-y-3 pt-3 border-t border-slate-200">
                          <h4 className="text-sm font-medium text-slate-600">Nöbetçi Öğretmen Ata</h4>
                          <p className="text-xs text-slate-500 -mt-2">
                            Atadığınız öğretmenler program oluşturulurken nöbet dönüş şekline göre yerleştirilir:
                            <strong className="text-slate-600"> Sabit</strong> öğretmenler hep bu yerde görev yapar,
                            <strong className="text-slate-600"> hareketli</strong> öğretmenlerin yeri haftalık döner.
                            Başka bir yerde de atanmış öğretmen <strong className="text-amber-700">çift nöbet</strong> olarak işaretlenir;
                            dağıtımda toplam nöbet sayısı gözetilir, aynı güne iki nöbet ancak başka uygun öğretmen yoksa verilir.
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
                                onChange={(e) => handleAssignTeacher(location.id, e.target.value)}
                                className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg bg-surface text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none"
                              >
                                <option value="">Öğretmen seçin…</option>
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
    </div>
  );
}
