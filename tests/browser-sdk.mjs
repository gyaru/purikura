// Only the Desktop host bridge is substituted; React, Query, Button/Input and
// the native stylesheet come from the real packages / HERMES_SOURCE checkout.
import {atom} from 'nanostores'
import {useStore} from '@nanostores/react'
import * as Query from '@tanstack/react-query'
export {Button} from 'desktop-button'
export {Input} from 'desktop-input'
export {atom}
export const useValue=useStore
export const useQuery=Query.useQuery, useMutation=Query.useMutation
export const queryClient=new Query.QueryClient()
export const host={state:{connectionId:atom('test-gateway'),profile:atom('default'),focusedSessionOwner:atom({connectionId:'test-gateway',profile:'default'})},notify:console.info,navigate(){}}
export const COMPOSER_AREAS={leading:'composer.leading',middleware:'composer.middleware'},ROUTES_AREA='routes',SIDEBAR_NAV_AREA='sidebar.nav'
