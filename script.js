import { apiKey, firebaseConfig } from "./api-key.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.12.1/firebase-app.js";
import {
    collection,
    deleteDoc,
    doc,
    GeoPoint,
    getDocs,
    getFirestore,
    onSnapshot,
    setDoc,
    Timestamp,
} from "https://www.gstatic.com/firebasejs/9.12.1/firebase-firestore.js";

// access Places database in Google Firestore

const app = initializeApp(firebaseConfig),
    firestore = getFirestore(app);

let firstLoad = true;

// create global map object

const map = makeMap();

function makeMap() {
    const map = new google.maps.Map(document.getElementById("map"), {
        zoom: 10,
    });
    map.addListener("click", (e) => {
        const { latLng } = e,
            form = document.getElementById("edit-place-form");
        form.address.value = "";
        form.lat.value = latLng.lat();
        form.lng.value = latLng.lng();
        form.addNew.checked = true;
        map.setCenter(latLng);
    });
    return map;
}

// populate map with pins

let markers = [];

const pinSize = new google.maps.Size(25, 40),
    regularPin = new google.maps.MarkerImage(
        "/my-map/assets/pin-regular.png",
        null /* size is determined at runtime */,
        null /* origin is 0,0 */,
        null /* anchor is bottom center of the scaled image */,
        pinSize
    ),
    highlightedPin = new google.maps.MarkerImage(
        "/my-map/assets/pin-highlighted.png",
        null /* size is determined at runtime */,
        null /* origin is 0,0 */,
        null /* anchor is bottom center of the scaled image */,
        pinSize
    );

async function initMap(querySnapshot, center) {
    // clear old place info
    document.getElementById("place-info").innerHTML =
        "Click a spot to see information.";
    // clear pins from map before loading with updated data
    markers.forEach((marker) => marker.setMap(null));
    markers = [];
    const data = await getAllPlaces(querySnapshot);
    map.setCenter(center);
    data.forEach((datum) => makeMarker(datum));
    !firstLoad &&
        markers
            .sort((a, b) => b.modified.seconds - a.modified.seconds)[0]
            .setIcon(highlightedPin);
    firstLoad = false;
}

async function getAllPlaces(querySnapshot) {
    querySnapshot =
        querySnapshot || (await getDocs(collection(firestore, "Places")));
    const result = [];
    querySnapshot.forEach((doc) => {
        // doc.data() is never undefined for query doc snapshots
        result.push({ ...doc.data(), id: doc.id });
    });
    return result.map((place) => ({
        ...place,
        position: {
            lat: place.position.latitude,
            lng: place.position.longitude,
        },
    }));
}

function makeMarker(datum) {
    const marker = new google.maps.Marker({
        ...datum,
        map,
        icon: regularPin,
    });
    // content = `
    //     <div id="content">
    //         <h1 id="firstHeading" class="firstHeading">${marker.title}</h1>
    //         <div id="bodyContent">
    //             <p>${marker.content}</p>
    //         </div>
    //     </div>`,
    // infoWindow = new google.maps.InfoWindow({
    //     content,
    //     ariaLabel: marker.title,
    // });
    addMarkerClickHandler(marker, datum);
    markers.push(marker);
}

function addMarkerClickHandler(marker, datum) {
    marker.addListener("click", ({ domEvent, latLng }) => {
        // show info
        const html = `
            <h1>${datum.title}</h1>
            <p>${datum.content}</p>`;
        document.getElementById("place-info").innerHTML = html;
        // make editable
        const editForm = document.getElementById("edit-place-form");
        editForm.title.value = datum.title;
        editForm.content.value = datum.content;
        editForm.address.value = datum.address;
        editForm.lat.value = datum.position.lat;
        editForm.lng.value = datum.position.lng;
        editForm.addNew.checked = false;
        editForm.setAttribute("data-id", datum.id);
        markers.forEach((m) =>
            m.setIcon(m === marker ? highlightedPin : regularPin)
        );
        map.setCenter(latLng);
        map.setZoom(14);
    });
}

// form handlers

async function updatePlace(event) {
    return (await updatePlaceHelper(event)) || alert("INVALID DATA");
}

async function updatePlaceHelper(event) {
    event.preventDefault();
    let { title, content, address, lat, lng, addNew } = getFormData(
        event.target
    );
    if (!title || !content) {
        return false;
    }
    if (!lat || !lng) {
        if (!address) {
            return false;
        }
        // get coords from address
        const newCoords = await fillCoordsInputsFromAddress(event.target);
        if (!newCoords) {
            return false;
        }
        lat = newCoords.lat;
        lng = newCoords.lng;
    }
    const datum = {
            title,
            content,
            address,
            position: new GeoPoint(+lat, +lng),
            modified: Timestamp.fromDate(new Date()),
        },
        id = event.target.getAttribute("data-id"),
        newId = lat + ":" + lng;
    await setDoc(doc(firestore, "Places", newId), datum);
    !addNew.checked && id && id !== newId && (await deleteDocHelper(id));
    event.target.setAttribute("data-id", newId);
    return true;
}

function getFormData(formElem) {
    const { title, content, address, lat, lng, addNew } = formElem,
        result = { title, content, address, lat, lng };
    Object.entries(result).forEach(
        ([key, val]) => (result[key] = val.value.trim())
    );
    return { ...result, addNew };
}

async function getCoords(event) {
    event.preventDefault();
    const form = event.target.parentNode.parentNode,
        coords = await fillCoordsInputsFromAddress(form);
    return coords;
}

async function fillCoordsInputsFromAddress(form) {
    const address = form.address.value.trim();
    if (!address) {
        return false;
    }
    const coords = await getCoordinatesFromAddress(address);
    if (!coords) {
        return false;
    }
    form.lat.value = coords.lat;
    form.lng.value = coords.lng;
    return coords;
}

async function getCoordinatesFromAddress(address) {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${address}&key=${apiKey}`,
        resp = await fetch(url),
        { results } = await resp.json();
    return results?.[0]?.geometry?.location;
}

function removePlace(event) {
    event.preventDefault();
    const id = event.target.parentNode.getAttribute("data-id");
    id ? deleteDocHelper(id) : alert("NO DOC ID");
}

async function deleteDocHelper(id) {
    await deleteDoc(doc(firestore, "Places", id));
}

function getCurrentLocation(event) {
    event.preventDefault();
    navigator.geolocation.getCurrentPosition(
        (position) => {
            const { latitude, longitude } = position.coords,
                form = event.target.parentNode;
            form.lat.value = latitude;
            form.lng.value = longitude;
            map.setCenter({ lat: latitude, lng: longitude });
        },
        () => alert("Could not get location.")
    );
}

// assign handlers to elements

document.getElementById("edit-place-form").onsubmit = (e) => updatePlace(e);

document.getElementById("get-coords-btn").onclick = (e) => getCoords(e);

document.getElementById("remove-place").onclick = (e) => removePlace(e);

document.getElementById("current-location-btn").onclick = (e) =>
    getCurrentLocation(e);

// create snapshot listener for Firestore

const unsub = onSnapshot(collection(firestore, "Places"), (querySnapshot) => {
    // get the most recently added or updated entry for its position
    const result = [];
    querySnapshot.forEach((doc) => result.push(doc.data()));
    result.sort((a, b) => b.modified.seconds - a.modified.seconds);
    const pos = result[0].position,
        center = { lat: pos.latitude, lng: pos.longitude };
    initMap(querySnapshot, center);
});

window.onunload = unsub;
