import { addComponent, defineQuery, entityExists, hasComponent } from "bitecs";
import { Text } from "troika-three-text";
import type { HubsWorld } from "../app";
import {
  EntityStateDirty,
  HoveredRemoteRight,
  Interacted,
  MediaContentBounds,
  MediaPDF,
  NetworkedPDF,
  ObjectMenuTransform,
  PDFMenu
} from "../bit-components";
import { anyEntityWith, findAncestorWithComponent } from "../utils/bit-utils";
import type { EntityID } from "../utils/networking-types";
import { takeOwnership } from "../utils/take-ownership";
import { PDFResourcesMap } from "./pdf-system";
import { ObjectMenuTransformFlags } from "../inflators/object-menu-transform";
import { canPin } from "../utils/bit-pinning-helper";

function clicked(world: HubsWorld, eid: EntityID) {
  return hasComponent(world, Interacted, eid);
}

function findPDFMenuTarget(world: HubsWorld, menu: EntityID, sceneIsFrozen: boolean) {
  if (PDFMenu.targetRef[menu] && !entityExists(world, PDFMenu.targetRef[menu])) {
    // Clear the invalid entity reference. (The pdf entity was removed).
    PDFMenu.targetRef[menu] = 0;
  }

  if (sceneIsFrozen) {
    PDFMenu.targetRef[menu] = 0;
    return;
  }

  const hovered = hoveredQuery(world);
  const target = hovered.map(eid => findAncestorWithComponent(world, MediaPDF, eid))[0] || 0;
  if (target) {
    PDFMenu.targetRef[menu] = target;
    PDFMenu.clearTargetTimer[menu] = world.time.elapsed + 1000;
    return;
  }

  if (hovered.some(eid => findAncestorWithComponent(world, PDFMenu, eid))) {
    PDFMenu.clearTargetTimer[menu] = world.time.elapsed + 1000;
    return;
  }

  if (world.time.elapsed > PDFMenu.clearTargetTimer[menu]) {
    PDFMenu.targetRef[menu] = 0;
    return;
  }
}

function wrapAround(n: number, min: number, max: number) {
  // Wrap around [min, max] inclusively
  // Assumes that n is only 1 more than max or 1 less than min
  return n < min ? max : n > max ? min : n;
}

function setPage(world: HubsWorld, eid: EntityID, pageNumber: number) {
  takeOwnership(world, eid);
  addComponent(world, EntityStateDirty, eid);
  NetworkedPDF.pageNumber[eid] = wrapAround(pageNumber, 1, PDFResourcesMap.get(eid)!.pdf.numPages);
}

function handleClicks(world: HubsWorld, menu: EntityID) {
  if (clicked(world, PDFMenu.nextButtonRef[menu])) {
    const pdf = PDFMenu.targetRef[menu];
    setPage(world, pdf, NetworkedPDF.pageNumber[pdf] + 1);
  } else if (clicked(world, PDFMenu.prevButtonRef[menu])) {
    const pdf = PDFMenu.targetRef[menu];
    setPage(world, pdf, NetworkedPDF.pageNumber[pdf] - 1);
  }
}

function flushToObject3Ds(world: HubsWorld, menu: EntityID, frozen: boolean) {
  const target = PDFMenu.targetRef[menu];
  const visible = !!(target && !frozen);

  const obj = world.eid2obj.get(menu)!;
  obj.visible = visible;

  // TODO We are handling menus visibility in a similar way for all the object menus, we
  // should probably refactor this to a common object-menu-visibility-system
  if (visible) {
    ObjectMenuTransform.targetObjectRef[menu] = target;
    ObjectMenuTransform.flags[menu] |= ObjectMenuTransformFlags.Enabled;
  } else {
    ObjectMenuTransform.flags[menu] &= ~ObjectMenuTransformFlags.Enabled;
  }

  // The media loader entity is the entity that's is actually pinned and decides
  // the pinnable state of the pdf component so we need to check the media loader entity pin
  // state to show/hide certain buttons. The media loader component is not present anymore after
  // the media has been loaded but it will always have a MediaContentBounds.
  // TODO We should use something more meaningful than MediaContentBounds for the media loader root entity
  // or rename it to something like MediaRoot.
  let canIPin = false;
  const mediaLoader = findAncestorWithComponent(world, MediaContentBounds, target);
  if (mediaLoader && canPin(APP.hubChannel!, mediaLoader)) {
    canIPin = true;
  }

  [PDFMenu.prevButtonRef[menu], PDFMenu.nextButtonRef[menu]].forEach(buttonRef => {
    const buttonObj = world.eid2obj.get(buttonRef)!;
    // Parent visibility doesn't block raycasting, so we must set each button to be invisible
    // TODO: Ensure that children of invisible entities aren't raycastable
    buttonObj.visible = visible && canIPin;
  });

  if (target) {
    const numPages = PDFResourcesMap.get(target)!.pdf.numPages;
    (world.eid2obj.get(PDFMenu.pageLabelRef[menu]) as Text).text = `${NetworkedPDF.pageNumber[target]} / ${numPages}`;
  }
}

const hoveredQuery = defineQuery([HoveredRemoteRight]);
export function pdfMenuSystem(world: HubsWorld, sceneIsFrozen: boolean) {
  const menu = anyEntityWith(world, PDFMenu)!;
  findPDFMenuTarget(world, menu, sceneIsFrozen);
  if (PDFMenu.targetRef[menu]) {
    handleClicks(world, menu);
  }
  flushToObject3Ds(world, menu, sceneIsFrozen);
}
