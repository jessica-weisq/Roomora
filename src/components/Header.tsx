import { Fragment } from 'react'
import type { ReactNode } from 'react'
import { Icon } from './Icon'

const STEPS = ['Upload', 'Review', 'Build', 'View']

export function Header({ step, right }: { step?: number; right?: ReactNode }) {
  return (
    <header className="header">
      <div className="header-inner">
        <div className="brand">
          <Icon name="cube" size={26} />
          {/* TODO: product name */}
          <span>Roomora</span>
        </div>
        {step !== undefined ? (
          <nav aria-label="Progress">
            <ol className="stepper">
              {STEPS.map((label, i) => (
                <Fragment key={label}>
                  {i > 0 && <li aria-hidden="true" className="stepper-sep" />}
                  <li
                    className={i === step ? 'step current' : i < step ? 'step done' : 'step'}
                    aria-current={i === step ? 'step' : undefined}
                  >
                    <span className="step-dot">{i < step ? <Icon name="check" size={14} strokeWidth={3} /> : i + 1}</span>
                    {label}
                  </li>
                </Fragment>
              ))}
            </ol>
          </nav>
        ) : (
          right
        )}
      </div>
    </header>
  )
}
