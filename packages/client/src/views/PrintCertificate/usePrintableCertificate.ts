/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * OpenCRVS is also distributed under the terms of the Civil Registration
 * & Healthcare Disclaimer located at http://opencrvs.org/license.
 *
 * Copyright (C) The OpenCRVS Authors located at https://github.com/opencrvs/opencrvs-core/blob/master/AUTHORS.
 */
import { WORKQUEUE_TABS } from '@client/components/interface/Navigation'
import {
  IPrintableDeclaration,
  SUBMISSION_STATUS,
  modifyDeclaration,
  writeDeclaration
} from '@client/declarations'
import { useDeclaration } from '@client/declarations/selectors'
import {
  CorrectionSection,
  IFormSectionData,
  SubmissionAction
} from '@client/forms'
import { goToCertificateCorrection, goToHomeTab } from '@client/navigation'
import { getOfflineData } from '@client/offline/selectors'
import { getScope, getUserDetails } from '@client/profile/profileSelectors'
import { IStoreState } from '@client/store'
import {
  hasRegisterScope,
  hasRegistrationClerkScope
} from '@client/utils/authUtils'
import { countries } from '@client/utils/countries'
import { cloneDeep } from 'lodash'
import { useState, useEffect } from 'react'
import { useIntl } from 'react-intl'
import { useDispatch, useSelector } from 'react-redux'
import {
  getPDFTemplateWithSVG,
  addFontsToSvg,
  printCertificate
} from './PDFUtils'
import {
  isCertificateForPrintInAdvance,
  getRegisteredDate,
  getEventDate,
  isFreeOfCost,
  calculatePrice,
  getCountryTranslations
} from './utils'
import { Event } from '@client/utils/gateway'
import { getUserName, UserDetails } from '@client/utils/userUtils'
import { formatLongDate } from '@client/utils/date-formatting'
import { IOfflineData } from '@client/offline/reducer'

const withEnhancedTemplateVariables = (
  declaration: IPrintableDeclaration | undefined,
  userDetails: UserDetails | null,
  offlineData: IOfflineData
) => {
  if (!declaration) {
    return declaration
  }

  const registeredDate = getRegisteredDate(declaration.data)
  const eventDate = getEventDate(declaration.data, declaration.event)
  const registrationFees = calculatePrice(
    declaration.event,
    eventDate,
    registeredDate,
    offlineData
  )
  return {
    ...declaration,
    data: {
      ...declaration.data,
      template: {
        ...declaration.data.template,
        printInAdvance: isCertificateForPrintInAdvance(declaration),
        certificateDate: formatLongDate(new Date().toISOString()),
        registrationFees,
        ...(userDetails && {
          loggedInUser: {
            name: getUserName(userDetails),
            officeId: userDetails.primaryOffice?.id,
            signature: userDetails.localRegistrar?.signature
          }
        })
      } as IFormSectionData
    }
  }
}

export const usePrintableCertificate = (declarationId: string) => {
  const declarationWithoutAllTemplateVariables = useDeclaration<
    IPrintableDeclaration | undefined
  >(declarationId)
  const userDetails = useSelector(getUserDetails)
  const offlineData = useSelector(getOfflineData)
  const declaration = withEnhancedTemplateVariables(
    declarationWithoutAllTemplateVariables,
    userDetails,
    offlineData
  )

  const state = useSelector((store: IStoreState) => store)
  const [svg, setSvg] = useState<string>()
  const isPrintInAdvance = isCertificateForPrintInAdvance(declaration)
  const intl = useIntl()
  const dispatch = useDispatch()
  const languages = useSelector((store: IStoreState) =>
    getCountryTranslations(store.i18n.languages, countries)
  )
  const scope = useSelector(getScope)
  const canUserEditRecord =
    declaration?.event !== Event.Marriage &&
    (hasRegisterScope(scope) || hasRegistrationClerkScope(scope))

  useEffect(() => {
    if (declaration)
      getPDFTemplateWithSVG(offlineData, declaration, state).then((svg) => {
        const svgWithFonts = addFontsToSvg(
          svg.svgCode,
          offlineData.templates.fonts ?? {}
        )
        setSvg(svgWithFonts)
      })
  }, [offlineData, declaration, state])

  const handleCertify = () => {
    const draft = cloneDeep(declaration) as IPrintableDeclaration

    draft.submissionStatus = SUBMISSION_STATUS.READY_TO_CERTIFY
    draft.action = isPrintInAdvance
      ? SubmissionAction.CERTIFY_DECLARATION
      : SubmissionAction.CERTIFY_AND_ISSUE_DECLARATION

    const registeredDate = getRegisteredDate(draft.data)
    const certificate = draft.data.registration.certificates[0]
    const eventDate = getEventDate(draft.data, draft.event)
    if (!isPrintInAdvance) {
      if (isFreeOfCost(draft.event, eventDate, registeredDate, offlineData)) {
        certificate.payments = {
          type: 'MANUAL' as const,
          amount: 0,
          outcome: 'COMPLETED' as const,
          date: new Date().toISOString()
        }
      } else {
        const paymentAmount = calculatePrice(
          draft.event,
          eventDate,
          registeredDate,
          offlineData
        )
        certificate.payments = {
          type: 'MANUAL' as const,
          amount: Number(paymentAmount),
          outcome: 'COMPLETED' as const,
          date: new Date().toISOString()
        }
      }
    }

    draft.data.registration = {
      ...draft.data.registration,
      certificates: [
        {
          ...certificate,
          data: svg || ''
        }
      ]
    }

    printCertificate(intl, draft, userDetails, offlineData, state, languages)

    dispatch(modifyDeclaration(draft))
    dispatch(writeDeclaration(draft))
    dispatch(goToHomeTab(WORKQUEUE_TABS.readyToPrint))
  }

  const handleEdit = () =>
    dispatch(
      goToCertificateCorrection(declarationId, CorrectionSection.Corrector)
    )

  return {
    svg,
    handleCertify,
    isPrintInAdvance,
    canUserEditRecord,
    handleEdit
  }
}
