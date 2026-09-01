'use client'

import { Dices, Lock, UserRoundCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useReducer, useRef } from 'react'

import { BottomActionBar, Button, Countdown, PlayerSelect, useToast } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { PredictEditorVM } from '@/lib/view-models'

import { savePredictionAction, type SaveState } from './actions'
import { randomPicks } from './random-picks'
import { draftReducer } from './reducer'
import { ScorePicker } from './score-picker'

const INITIAL_SAVE: SaveState = { ok: false, error: null }

export interface PredictionFormProps {
  editor: PredictEditorVM
}

/**
 * Dueno del borrador (D6): un useReducer sembrado por props desde el Server
 * Component. Nada se persiste hasta enviar el formulario.
 */
export function PredictionForm({ editor }: PredictionFormProps) {
  const { match, squads, suggestions, initialDraft, scoring } = editor

  const [draft, dispatch] = useReducer(draftReducer, initialDraft)
  const [state, formAction, pending] = useActionState(savePredictionAction, INITIAL_SAVE)
  const router = useRouter()
  const toast = useToast()

  // useActionState devuelve un objeto nuevo por envio: comparar la identidad
  // basta para reaccionar una sola vez a cada respuesta.
  const handled = useRef<SaveState>(INITIAL_SAVE)
  useEffect(() => {
    if (state === handled.current) return
    handled.current = state

    if (state.ok) {
      toast('Pronóstico guardado y sellado')
      router.push('/jornada')
      return
    }
    if (state.error) {
      toast(state.error, 'bad')
      // Si el rechazo es porque el partido se cerro entre medias, al refrescar
      // el servidor vuelve a decidir y la pantalla cae en <SealedCard> (4b).
      router.refresh()
    }
  }, [state, router, toast])

  const noGoalsLabel = draft.noGoals ? 'Sin goles · nadie marca ni asiste' : 'Marcar «sin goles»'

  /**
   * Tope de goleadores y de asistentes: los goles de TU pronostico.
   *
   * Sin esto se sacaban puntos a base de cantidad -- poner 1-2 y soltar doce
   * nombres, porque cada acierto sumaba igual. El servidor y la base tambien lo
   * rechazan; aqui se evita ademas que se pueda llegar a intentar.
   */
  const totalGoles = draft.home + draft.away

  /**
   * Modo aleatorio, para quien no tiene tiempo de elegir nombre por nombre.
   *
   * DEPENDE DEL MARCADOR: cuantos nombres saca y de que equipo lo dice el
   * resultado que hayas puesto. Un 2-1 son dos del local y uno del visitante.
   * Por eso con el marcador a 0-0 no hay nada que sortear y lo dice en vez de no
   * hacer nada.
   *
   * Rellena los huecos y respeta lo que ya hubieras elegido. Cuando ya esta todo
   * lleno el boton cambia de texto y vuelve a tirar: asi la pulsacion siempre
   * hace algo y siempre se sabe qué.
   */
  const homePlayers = squads.find((s) => s.code === match.home.code)?.players ?? []
  const awayPlayers = squads.find((s) => s.code === match.away.code)?.players ?? []
  const sinPlantillas = homePlayers.length === 0 && awayPlayers.length === 0
  const yaLleno =
    totalGoles > 0 && draft.scorers.length >= totalGoles && draft.assists.length >= totalGoles

  function tirarDado() {
    if (totalGoles === 0) {
      toast('Pon primero el marcador: en un 0-0 no hay goleadores que sortear.', 'bad')
      return
    }
    if (sinPlantillas) {
      toast('Todavía no tenemos las plantillas de estos dos equipos.', 'bad')
      return
    }
    const picks = randomPicks({
      homeGoals: draft.home,
      awayGoals: draft.away,
      homePlayers,
      awayPlayers,
      // Al volver a tirar se parte de cero; si no, se rellenan los huecos.
      scorers: yaLleno ? [] : draft.scorers,
      assists: yaLleno ? [] : draft.assists,
    })
    dispatch({ type: 'randomFill', ...picks })
    toast(yaLleno ? 'Otra tirada.' : 'Sorteado. Cámbialo si no te gusta.')
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="matchId" value={match.id} />
      <input type="hidden" name="home" value={draft.home} />
      <input type="hidden" name="away" value={draft.away} />
      <input type="hidden" name="mvp" value={draft.mvp ?? ''} />
      <input type="hidden" name="scorers" value={JSON.stringify(draft.scorers)} />
      <input type="hidden" name="assists" value={JSON.stringify(draft.assists)} />
      <input type="hidden" name="noGoals" value={draft.noGoals ? '1' : ''} />

      {/* El padding inferior reserva el hueco de la barra fija: sin el, la
          tarjeta del aviso queda debajo del boton de guardar. */}
      <div className="flex flex-col gap-[14px] px-[14px] pt-[16px] pb-[calc(env(safe-area-inset-bottom)+132px)]">
        <ScorePicker
          home={match.home}
          away={match.away}
          homeGoals={draft.home}
          awayGoals={draft.away}
          onGoals={(side, value) => dispatch({ type: 'setGoals', side, value })}
          onQuickScore={(home, away) => dispatch({ type: 'setScore', home, away })}
        />

        <PlayerSelect
          label="MVP del partido"
          hint={`+${scoring.mvp} pts`}
          squads={squads}
          suggestions={suggestions}
          selected={draft.mvp ? [draft.mvp] : []}
          multiple={false}
          emptyLabel="Elegir jugador"
          onToggle={(player) => dispatch({ type: 'toggleMvp', player })}
        />

        {/* Antes de las dos listas, que es lo que rellena. */}
        <div className="rounded-[16px] border border-line bg-card px-[14px] py-[12px]">
          <Button
            type="button"
            variant="secondary"
            size="lg"
            fullWidth
            onClick={tirarDado}
            leading={<Dices size={17} strokeWidth={2.3} aria-hidden />}
          >
            {yaLleno ? 'Volver a tirar' : 'Modo aleatorio'}
          </Button>
          <p className="mt-[9px] text-[11.5px] font-semibold leading-[1.4] text-txt3">
            {totalGoles === 0
              ? 'Pon el marcador y esto te sortea los goleadores y los asistentes.'
              : `Te sortea ${totalGoles} goleador${totalGoles === 1 ? '' : 'es'} y ${totalGoles} asistente${totalGoles === 1 ? '' : 's'} según tu ${draft.home}-${draft.away}. De la plantilla entera, titulares o suplentes. Puntúan igual que si los eliges tú.`}
          </p>
        </div>

        <PlayerSelect
          label="Goleadores"
          hint={`${draft.scorers.length}/${totalGoles} · +${scoring.scorer} pts`}
          max={totalGoles}
          squads={squads}
          suggestions={suggestions}
          selected={draft.scorers}
          multiple
          emptyLabel="Elegir goleadores"
          onToggle={(player) => dispatch({ type: 'toggleScorer', player })}
          onRemove={(player) => dispatch({ type: 'removeScorer', player })}
        >
          <button
            type="button"
            aria-pressed={draft.noGoals}
            onClick={() => dispatch({ type: 'toggleNoGoals' })}
            className={cn(
              'mt-[11px] flex min-h-[46px] w-full items-center justify-center gap-[8px]',
              'rounded-[13px] border px-[14px] text-[14px] font-bold',
              'transition-transform duration-100 active:scale-[.97] active:opacity-90',
              draft.noGoals
                ? 'border-accent bg-accent-soft text-accent2'
                : 'border-line2 bg-transparent text-txt2',
            )}
          >
            {noGoalsLabel}
          </button>

          {/* El 0-0 no se pone nunca porque renuncia a los goleadores y a los
              asistentes de entrada. Si no se dice que hay premio, el premio no
              cambia nada: la gracia es que se sepa ANTES de elegir. */}
          {totalGoles === 0 && (
            <p className="mt-[9px] text-[11.5px] font-semibold leading-[1.45] text-ok">
              Un 0-0 clavado paga {scoring.exact + scoring.goalless} puntos: los {scoring.exact} del
              marcador exacto más {scoring.goalless} de premio, porque aquí no hay goleadores que
              acertar.
            </p>
          )}
        </PlayerSelect>

        <PlayerSelect
          label="Asistentes"
          hint={`${draft.assists.length}/${totalGoles} · +${scoring.assist} pts`}
          max={totalGoles}
          squads={squads}
          suggestions={suggestions}
          selected={draft.assists}
          multiple
          emptyLabel="Elegir asistentes"
          onToggle={(player) => dispatch({ type: 'toggleAssist', player })}
          onRemove={(player) => dispatch({ type: 'removeAssist', player })}
        />

        <div className="flex gap-[9px] rounded-[16px] border border-line bg-accent-soft px-[14px] py-[12px]">
          <Lock size={16} strokeWidth={2.1} aria-hidden className="mt-[1px] flex-none text-accent2" />
          <p className="text-[12.5px] font-semibold leading-[1.45] text-txt2">
            Se sella al pitido inicial. Hasta entonces puedes cambiarlo las veces que quieras y{' '}
            <b className="font-extrabold text-txt">nadie lo ve</b>.
          </p>
        </div>

        {/* La regla existe desde la migracion 0026 y no se veia en ningun sitio:
            una regla que reparte puntos y nadie conoce solo sirve para que
            parezca que la app se equivoca. */}
        <div className="flex gap-[9px] rounded-[16px] border border-line bg-card px-[14px] py-[12px]">
          <UserRoundCheck
            size={16}
            strokeWidth={2.1}
            aria-hidden
            className="mt-[1px] flex-none text-ok"
          />
          <p className="text-[12.5px] font-semibold leading-[1.45] text-txt2">
            <b className="font-extrabold text-txt">Sustituto +</b>: si cambian a tu goleador o
            asistente, <b className="font-extrabold text-txt">su relevo también te cuenta</b>. Y si
            cambian al relevo, sigue. No hace falta poner a los dos: no suma el doble y gastas un
            hueco. El MVP no entra.
          </p>
        </div>
      </div>

      <BottomActionBar>
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] font-extrabold uppercase tracking-[.08em] text-txt3">
            Cierra en
          </p>
          <Countdown deadlineAt={match.kickoffAt} className="text-[19px] leading-[1.15]" />
        </div>
        <Button type="submit" variant="primary" loading={pending} className="flex-none px-[26px]">
          {match.myPrediction ? 'Actualizar' : 'Guardar'}
        </Button>
      </BottomActionBar>
    </form>
  )
}
