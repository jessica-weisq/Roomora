import { Fragment } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from './Icon'
import { ThemeMenu } from './ThemeMenu'
import { useTheme } from '../state/theme'
import logo from '../assets/logo.png'
import logoDark from '../assets/logo-dark.png'

const STEPS = ['Upload', 'Review', 'Build', 'View']

export function Header({ step, right }: { step?: number; right?: ReactNode }) {
  const { resolved } = useTheme()
  return (
    <header className="header">
      <div className="header-inner">
        <Link to="/" className="brand" aria-label="Veduta home">
          <img src={resolved === 'dark' ? logoDark : logo} alt="Veduta" width={105} height={44} />
        </Link>
        <div className="header-end">
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
          <Link to="/about" className="header-link">
            About
          </Link>
          <ThemeMenu />
        </div>
      </div>
    </header>
  )
}
